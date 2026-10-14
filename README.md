# FFMusic

Bot de música para [Fluxer](https://fluxer.app), escrito en TypeScript con [Fluxer.js](https://fluxer.js.org). Reproduce audio de YouTube en canales de voz mediante [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Comandos

| Comando | Descripción |
| --- | --- |
| `!help` | Muestra la lista de comandos |
| `!ping` | Comprueba que el bot responde |
| `!join` | Une el bot a tu canal de voz |
| `!leave` | Saca al bot del canal (tienes que estar en el mismo canal) |
| `!play <enlace>` | Añade una canción a la cola y la reproduce si no suena nada |
| `!skip` | Salta la canción actual |
| `!stop` | Para la música y vacía la cola |
| `!pause` | Pausa la música |
| `!resume` | Retoma la música (la canción vuelve a empezar desde el principio) |
| `!queue` | Muestra la canción actual y las pendientes |

## Requisitos

- Node.js 20 o superior
- Python 3 (solo en Linux, lo necesita yt-dlp)

## Instalación

```bash
git clone <url-del-repositorio>
cd FFMusic
npm ci
```

`npm ci` instala las dependencias y descarga yt-dlp automáticamente.

## Configuración

Crea un archivo `.env` en la raíz del proyecto (puedes copiar `.env.example`):

```
SELFHOST_BOT_TOKEN=token_del_bot
SELFHOST_URL=https://tu-instancia-de-fluxer
```

- `SELFHOST_BOT_TOKEN`: el token del bot, que se genera en Fluxer en *User Settings > Applications*.
- `SELFHOST_URL`: la dirección de la instancia de Fluxer a la que se conecta el bot.

El token tiene que estar creado en la misma instancia a la que se conecta el bot.

## Uso

Durante el desarrollo:

```bash
npx tsx --env-file=.env src/bot.ts
```

En producción, compilando antes a JavaScript:

```bash
npx tsc
node --env-file=.env dist/bot.js
```

## Notas

- `@fluxerjs/core` está fijado a la versión 3.1.0 para que coincida con la que usa `@fluxerjs/voice`. No lo actualices por separado.
- Si YouTube empieza a dar errores, actualiza yt-dlp:
  ```bash
  ./node_modules/youtube-dl-exec/bin/yt-dlp -U
  ```
- La pausa no es real: la librería de voz todavía no permite pausar, así que `!resume` vuelve a empezar la canción.
> **Aviso:** este es un proyecto escolar con fines educativos. No apoya ni fomenta la piratería ni la descarga de contenido protegido por derechos de autor. Respeta siempre los términos de servicio de las plataformas que utilices.
