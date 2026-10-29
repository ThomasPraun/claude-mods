# open-sessions

Mod para Claude Code que muestra, en un panel junto al chat, todas las sesiones de Claude Code
abiertas en tus PCs (macOS, Windows y Linux) y el estado de cada una:

- 🔴 **te espera**: pide un permiso o una decisión (con el motivo cuando lo hay)
- 🟠 **ocupada**: está trabajando
- 🔵 **libre**: terminó su turno

Las sesiones aparecen agrupadas por PC. Cuando una sesión pasa a 🔴 aparece un aviso. El
comando `/sesiones` vuelve a abrir el panel si lo cerraste.

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
