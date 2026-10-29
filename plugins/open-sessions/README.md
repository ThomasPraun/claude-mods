# open-sessions

Mod para Claude Code que muestra, en un panel junto al chat, las sesiones de Claude Code abiertas
en tu PC y las de tu cuenta con **Remote Control** activo en cualquier otra PC, con el estado de
cada una:

- 🔴 **te espera**: pide un permiso o una decisión (con el motivo cuando lo hay)
- 🟠 **ocupada**: está trabajando
- 🔵 **libre**: terminó su turno

Cada sesión muestra su nombre, el título del chat, la carpeta o el repositorio, el estado y cuánto
tiempo lleva en él ("ocupada · 12 min"). El comando `/sesiones` vuelve a abrir el panel si lo
cerraste.

Al tocar una sesión se abre: las de la app de escritorio y las de Remote Control en su chat de la
app, y las de la terminal enfocando su panel de [herdr](https://herdr.dev) (si corren dentro de
herdr).

El icono **⧉** junto al nombre de cada sesión copia ese nombre. Pegado en otra conversación
("pásale esto a orkestra-37"), Claude puede enviarle un mensaje a esa sesión.

## Sesiones de otras PCs

Una sesión de otra PC aparece en el grupo **Remote Control** solo si tiene Remote Control activo
y conectado: así decides en cada PC qué se ve desde las demás. El mod las lee cada 30 segundos de
tu cuenta de Anthropic, con la sesión con la que ya iniciaste Claude Code (el mod nunca ve tu
credencial).

- La cuenta no dice en qué PC corre cada una, así que se agrupan juntas y muestran su
  repositorio.
- Si una sesión de esta PC también tiene Remote Control, se muestra una sola vez, en esta PC.
- Usa el mismo servicio interno que Claude Code para listar sesiones, que no está documentado:
  una actualización de Claude Code puede cambiarlo. Si deja de responder, el panel lo avisa y
  sigue mostrando las sesiones de esta PC.
- Solo funciona con sesión iniciada en claude.ai, no con una API key ni otro proveedor.

## Avisos

- Cuando una sesión te espera: aviso y sonido de tres pitidos.
- Cuando una sesión termina (pasa de ocupada a libre): aviso, sonido ascendente y la marca
  **✓ terminó** hasta que la tocas o vuelve a trabajar.
- Cuando un subagente del chat actual te espera o termina: aviso.

El sonido suena una sola vez aunque tengas varias sesiones con el mod abiertas. Solo suena en
macOS: en Windows y Linux Claude Code no tiene reproductor.

## Secciones

Abajo del todo, en una tarjeta, están **Subagentes** y **Uso**. Si el chat actual lanzó
subagentes, se muestra cada uno con su tipo, modelo y estado; los terminados quedan atenuados
(hasta los últimos cinco). **Uso** muestra cuánto contexto lleva la sesión actual y cuánto queda
de los límites de 5 horas y 7 días de tu cuenta, con la hora en que se reinicia cada uno.

Cada sección (esta PC, Remote Control, Subagentes y Uso) se pliega y despliega al tocar su
título. El título de cada grupo cuenta siempre sus sesiones por estado (●🔴 ●🟠 ●🔵 y ✓ las
terminadas sin ver), y un grupo plegado sigue mostrando las sesiones que te esperan o terminaron
sin que las vieras, para que nunca se te pase una.

## Instalación

```
/plugin install open-sessions --marketplace ThomasPraun/claude-mods
```

Más opciones en el [README del repositorio](../../README.md).
