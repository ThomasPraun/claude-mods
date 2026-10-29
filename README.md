# claude-mods

Mods para Claude Code.

| Mod | Qué hace |
| --- | --- |
| [open-sessions](plugins/open-sessions) | Panel junto al chat con todas las sesiones de Claude Code abiertas en tus PCs, su estado, los subagentes del chat actual y el uso de contexto y límites 5h/7d |
| [usage-band](plugins/usage-band) | Línea bajo el prompt con usuario, carpeta, rama, modelo y título del chat; añade el modelo a cada fila de subagente del historial |

## Instalación

En una sesión de Claude Code en la terminal:

```
/plugin install open-sessions --marketplace ThomasPraun/claude-mods
/plugin install usage-band --marketplace ThomasPraun/claude-mods
```

Responde `y` para añadir el marketplace y elige el alcance de usuario (user scope).

Desde una shell:

```bash
claude plugin install open-sessions --marketplace ThomasPraun/claude-mods
```

```bash
claude plugin install usage-band --marketplace ThomasPraun/claude-mods
```

En la app de escritorio: pulsa **+** junto al cuadro de texto, luego **Plugins**, **Add
marketplace** con `ThomasPraun/claude-mods` y después **Add plugin**.

Para actualizar: `/plugin update`.
