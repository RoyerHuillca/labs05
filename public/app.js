// Cliente: consume la API del servidor con fetch.
const tabla = document.getElementById('tabla');
const form = document.getElementById('form-estudiante');
const mensaje = document.getElementById('mensaje');

function mostrarMensaje(texto, tipo) {
  mensaje.textContent = texto;
  mensaje.className = tipo;
}

async function cargarEstudiantes() {
  try {
    const respuesta = await fetch('/api/estudiantes');
    const lista = await respuesta.json();
    tabla.innerHTML = '';
    lista.forEach((e) => {
      const fila = document.createElement('tr');
      [e.id, e.nombre, e.codigo, e.carrera, e.semestre ?? '-'].forEach((valor) => {
        const celda = document.createElement('td');
        celda.textContent = valor; // textContent evita inyección de HTML
        fila.appendChild(celda);
      });
      tabla.appendChild(fila);
    });
  } catch {
    mostrarMensaje('No se pudo cargar la lista de estudiantes', 'error');
  }
}

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(form));
  try {
    const respuesta = await fetch('/api/estudiantes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
    const resultado = await respuesta.json();
    if (!respuesta.ok) return mostrarMensaje(resultado.message, 'error');
    mostrarMensaje(`Estudiante guardado con id ${resultado.id} (201 Created)`, 'ok');
    form.reset();
    cargarEstudiantes();
  } catch {
    mostrarMensaje('Error de conexión con el servidor', 'error');
  }
});

cargarEstudiantes();
