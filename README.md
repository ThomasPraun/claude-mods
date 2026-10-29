# open-sessions

Mod para Claude Code que muestra, en un panel junto al chat, todas las sesiones de Claude Code
abiertas en tus PCs (macOS, Windows y Linux) y el estado de cada una:

- 🔴 **te espera**: pide un permiso o una decisión (con el motivo cuando lo hay)
- 🟠 **ocupada**: está trabajando
- 🔵 **libre**: terminó su turno

Las sesiones aparecen agrupadas por PC. Cuando una sesión pasa a 🔴 aparece un aviso. El
comando `/sesiones` vuelve a abrir el panel si lo cerraste.

Al tocar una sesión de la misma PC se abre: las de la app de escritorio en su chat, y las de la
terminal enfocando su panel de [herdr](https://herdr.dev) (si corren dentro de herdr). Las
sesiones de otras PCs solo se muestran.

Si el chat actual lanzó subagentes, la sección **Subagentes** muestra cada uno con su tipo,
modelo y estado; los terminados quedan atenuados (hasta los últimos cinco).

Cuando una sesión termina (pasa de ocupada a libre) aparece un aviso y queda marcada con
**✓ terminó** hasta que la tocas o vuelve a trabajar. También hay aviso cuando un subagente te
espera o termina.

Cada sección (cada PC, Subagentes y Uso) se pliega y despliega al tocar su título. El título
de cada PC cuenta siempre sus sesiones por estado (●🔴 ●🟠 ●🔵 y ✓ las terminadas sin ver), y
una sección plegada sigue mostrando las sesiones que te esperan o terminaron sin que las vieras,
para que nunca se te pase una.

Abajo, la sección **Uso** muestra cuánto contexto lleva la sesión actual y cuánto queda de los
límites de 5 horas y 7 días de tu cuenta, con la hora en que se reinicia cada uno.

El botón **copiar** junto a cada sesión copia su nombre. Pegado en otra conversación ("pásale
esto a orkestra-37"), Claude puede enviarle un mensaje a esa sesión.

## Cómo se comparten las sesiones entre PCs

Cada PC lee sus propias sesiones de `~/.claude/sessions` y las publica en un **Gist secreto**
de tu cuenta de GitHub (descripción `claude-open-sessions`), que el mod crea la primera vez.
Cada PC lee del mismo Gist las sesiones de las demás.

- Solo se sube el nombre de la sesión, la carpeta del proyecto, el estado y el nombre de la PC.
  Nada del contenido de las conversaciones.
- Las sesiones de las otras PCs se actualizan cada ~15 segundos.
- Una PC que lleva 2 minutos sin reportar se oculta.

## Requisitos

[GitHub CLI](https://cli.github.com) (`gh`) instalado y con sesión iniciada en la **misma cuenta
de GitHub** en cada PC:

```bash
gh auth login
```

Sin `gh`, el panel muestra solo las sesiones de la PC en la que corre.

## Instalación

En una sesión de Claude Code en la terminal:

```
/plugin install open-sessions --marketplace ThomasPraun/claude-mods
```

Responde `y` para añadir el marketplace y elige el alcance de usuario (user scope).

Desde una shell:

```bash
claude plugin install open-sessions --marketplace ThomasPraun/claude-mods
```

En la app de escritorio: pulsa **+** junto al cuadro de texto, luego **Plugins**, **Add
marketplace** con `ThomasPraun/claude-mods` y después **Add plugin**.

Para actualizar: `/plugin update`.
