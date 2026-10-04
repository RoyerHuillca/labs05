// server.js
// Laboratorio 05 - Servidor HTTP con módulos nativos (http, fs, path).
// Sin librerías externas: todo se resuelve con la API estándar de Node.js.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'estudiantes.json');
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

// Tabla de tipos MIME para inferir el Content-Type según la extensión.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

// ---------- Utilidades de respuesta ----------

function sendJSON(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendNotFound(res) {
  sendJSON(res, 404, { message: 'Recurso no encontrado' });
}

// ---------- Persistencia en archivo JSON (asíncrona) ----------

function leerEstudiantes() {
  return new Promise((resolve, reject) => {
    fs.readFile(DATA_FILE, 'utf-8', (err, contenido) => {
      if (err) {
        // Si el archivo aún no existe, se parte de una lista vacía.
        if (err.code === 'ENOENT') return resolve([]);
        return reject(err);
      }
      try {
        const lista = JSON.parse(contenido || '[]');
        resolve(Array.isArray(lista) ? lista : []);
      } catch (parseError) {
        reject(parseError);
      }
    });
  });
}

function guardarEstudiantes(lista) {
  return new Promise((resolve, reject) => {
    fs.writeFile(DATA_FILE, JSON.stringify(lista, null, 2), 'utf-8', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Cola de escrituras: evita condiciones de carrera si llegan varios POST a la vez.
let colaEscritura = Promise.resolve();

function agregarEstudiante(nuevo) {
  const tarea = colaEscritura.then(async () => {
    const lista = await leerEstudiantes();
    const siguienteId = lista.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
    const registro = { id: siguienteId, ...nuevo };
    lista.push(registro);
    await guardarEstudiantes(lista);
    return registro;
  });
  colaEscritura = tarea.catch(() => {});
  return tarea;
}

// ---------- Validación del body ----------

function validarEstudiante(datos) {
  if (datos === null || typeof datos !== 'object' || Array.isArray(datos)) {
    return { error: 'El cuerpo debe ser un objeto JSON' };
  }
  const nombre = typeof datos.nombre === 'string' ? datos.nombre.trim() : '';
  const codigo = datos.codigo !== undefined ? String(datos.codigo).trim() : '';
  const carrera = typeof datos.carrera === 'string' ? datos.carrera.trim() : '';

  if (!nombre || !codigo || !carrera) {
    return { error: 'Los campos nombre, codigo y carrera son obligatorios' };
  }

  const estudiante = { nombre, codigo, carrera };
  if (datos.semestre !== undefined && datos.semestre !== '') {
    const semestre = Number(datos.semestre);
    if (!Number.isInteger(semestre) || semestre < 1 || semestre > 12) {
      return { error: 'El campo semestre debe ser un entero entre 1 y 12' };
    }
    estudiante.semestre = semestre;
  }
  return { estudiante };
}

// ---------- Manejadores de rutas ----------

async function manejarGetEstudiantes(res) {
  try {
    const lista = await leerEstudiantes();
    sendJSON(res, 200, lista);
  } catch (err) {
    console.error('Error al leer estudiantes:', err.message);
    sendJSON(res, 500, { message: 'Error interno del servidor' });
  }
}

function manejarPostEstudiantes(req, res) {
  const chunks = [];
  let recibido = 0;
  let abortado = false;

  // El body llega por "streaming": se acumulan los chunks en el evento 'data'.
  req.on('data', (chunk) => {
    if (abortado) return;
    recibido += chunk.length;
    if (recibido > MAX_BODY_BYTES) {
      abortado = true;
      sendJSON(res, 413, { message: 'El cuerpo de la petición es demasiado grande' }, { Connection: 'close' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  // Al terminar el stream ('end') se parsea el objeto y se persiste.
  req.on('end', async () => {
    if (abortado) return;

    let datos;
    try {
      datos = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    } catch {
      return sendJSON(res, 400, { message: 'JSON inválido en el cuerpo de la petición' });
    }

    const { estudiante, error } = validarEstudiante(datos);
    if (error) return sendJSON(res, 400, { message: error });

    try {
      const guardado = await agregarEstudiante(estudiante);
      sendJSON(res, 201, guardado);
    } catch (err) {
      console.error('Error al guardar estudiante:', err.message);
      sendJSON(res, 500, { message: 'Error interno del servidor' });
    }
  });

  req.on('error', (err) => {
    console.error('Error en la petición:', err.message);
  });
}

// ---------- Archivos estáticos ----------

function servirEstatico(pathname, method, res) {
  if (method !== 'GET' && method !== 'HEAD') return sendNotFound(res);

  let relativo;
  try {
    relativo = decodeURIComponent(pathname);
  } catch {
    return sendNotFound(res);
  }
  if (relativo === '/') relativo = '/index.html';

  // path.join + normalize y verificación contra PUBLIC_DIR evitan "path traversal" (../).
  const filePath = path.join(PUBLIC_DIR, path.normalize(relativo));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendNotFound(res);
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

  fs.readFile(filePath, (err, contenido) => {
    if (err) {
      if (err.code === 'ENOENT' || err.code === 'EISDIR') return sendNotFound(res);
      console.error('Error al leer archivo estático:', err.message);
      return sendJSON(res, 500, { message: 'Error interno del servidor' });
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': contenido.length });
    res.end(method === 'HEAD' ? undefined : contenido);
  });
}

// ---------- Servidor ----------

const server = http.createServer((req, res) => {
  console.log(`Petición recibida: ${req.method} ${req.url}`);

  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (pathname === '/api/status' && req.method === 'GET') {
    return sendJSON(res, 200, { status: 'OK', uptime: process.uptime() });
  }

  if (pathname === '/api/estudiantes') {
    if (req.method === 'GET') return manejarGetEstudiantes(res);
    if (req.method === 'POST') return manejarPostEstudiantes(req, res);
    return sendJSON(res, 405, { message: 'Método no permitido' }, { Allow: 'GET, POST' });
  }

  if (pathname.startsWith('/api/')) return sendNotFound(res);

  servirEstatico(pathname, req.method, res);
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});