import { Client, Events, VoiceChannel, Message } from "@fluxerjs/core";
import { getVoiceManager, type VoiceConnectionLike } from "@fluxerjs/voice";
import { youtubeDl } from "youtube-dl-exec";

// ---------- Configuración ----------

const botToken = process.env.SELFHOST_BOT_TOKEN;
const serverUrl = process.env.SELFHOST_URL;

if (!botToken) {
    throw new Error("El token no existe");
}

if (!serverUrl) {
    throw new Error("La URL del servidor no existe");
}

// ---------- Cliente y gestor de voz ----------

const client = await Client.fromDiscovery(serverUrl, { intents: 0 });
const voiceManager = getVoiceManager(client);

// ---------- Estado del bot ----------

// ID de comunidad -> enlaces pendientes
const colas = new Map<string, string[]>();

// ID de comunidad -> enlace que está sonando
const actuales = new Map<string, string>();

// IDs de comunidades con la música en pausa
const pausadas = new Set<string>();

// ---------- Funciones auxiliares ----------

// Devuelve el canal de voz del autor del mensaje, o null si no se puede
async function obtenerCanalDeVoz(message: Message) {
    const idComunidad = message.guild?.id;
    if (!idComunidad) {
        await message.reply("Este comando solo funciona dentro de una comunidad.");
        return null;
    }

    const canalId = voiceManager.getVoiceChannelId(idComunidad, message.author.id);
    if (!canalId) {
        await message.reply("Tienes que estar en un canal de voz.");
        return null;
    }

    const canal = client.channels.get(canalId);
    if (!(canal instanceof VoiceChannel)) {
        return null;
    }

    return canal;
}

// Devuelve la cola de una comunidad, creándola si no existe
function obtenerCola(idComunidad: string) {
    let cola = colas.get(idComunidad);
    if (!cola) {
        cola = [];
        colas.set(idComunidad, cola);
    }
    return cola;
}

// Saca la primera canción de la cola y la reproduce
async function reproducirSiguiente(idComunidad: string, conexion: VoiceConnectionLike) {
    const siguiente = colas.get(idComunidad)?.shift();

    // Cola vacía: ya no suena nada
    if (!siguiente) {
        actuales.delete(idComunidad);
        return;
    }

    actuales.set(idComunidad, siguiente);

    try {
        // yt-dlp descarga el audio y lo envía directamente al bot
        const proceso = youtubeDl.exec(
            siguiente,
            {
                output: "-",
                format: "bestaudio[ext=webm][acodec=opus]/bestaudio[ext=webm]",
                noPlaylist: true,
            },
            // El audio se recoge para el bot; los mensajes de yt-dlp salen en la consola
            { stdio: ["inherit", "pipe", "inherit"] },
        );

        // Evita que el bot se caiga si yt-dlp termina con error
        proceso.catch((error) => console.error(`yt-dlp falló con ${siguiente}:`, error.message));

        if (!proceso.stdout) {
            throw new Error("yt-dlp no devolvió audio");
        }

        await conexion.play(proceso.stdout);
        vigilarFinal(idComunidad, conexion);
    } catch (error) {
        // Si la canción falla, se salta y se prueba con la siguiente
        console.error(`No se pudo reproducir ${siguiente}:`, error);
        await reproducirSiguiente(idComunidad, conexion);
    }
}

// Comprueba cada segundo si la canción ha terminado para poner la siguiente
function vigilarFinal(idComunidad: string, conexion: VoiceConnectionLike) {
    const intervalo = setInterval(async () => {
        if (conexion.playing) return;

        clearInterval(intervalo);

        // En pausa no se avanza
        if (pausadas.has(idComunidad)) return;

        await reproducirSiguiente(idComunidad, conexion);
    }, 1000);
}

// Borra todo el estado de música de una comunidad
function limpiarEstado(idComunidad: string) {
    colas.delete(idComunidad);
    actuales.delete(idComunidad);
    pausadas.delete(idComunidad);
}

// ---------- Eventos ----------

client.on(Events.Ready, () => {
    console.log(`${client.user?.username} está listo para la música`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // Comprueba que el bot responde
    if (message.content === "!ping") {
        await message.reply("Pong!");
    }

    // Muestra la lista de comandos disponibles
    if (message.content === "!help") {
        const ayuda = [
            "Comandos disponibles:",
            "!ping - Comprueba que el bot responde",
            "!join - Une el bot a tu canal de voz",
            "!leave - Saca al bot del canal (tienes que estar en el mismo canal)",
            "!play <enlace> - Añade una canción a la cola y la reproduce si no suena nada",
            "!skip - Salta la canción actual",
            "!stop - Para la música y vacía la cola",
            "!pause - Pausa la música",
            "!resume - Retoma la música (la canción vuelve a empezar)",
            "!queue - Muestra la canción actual y las pendientes",
            "!help - Muestra esta ayuda",
        ];

        await message.reply(ayuda.join("\n"));
    }

    // Une el bot al canal de voz del usuario
    if (message.content === "!join") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        try {
            await voiceManager.join(canal);
            await message.reply("Me he unido al canal.");
        } catch (error) {
            console.error(error);
            await message.reply("No he podido unirme al canal de voz.");
        }
    }

    // Saca al bot del canal, solo si el usuario está en el mismo canal
    if (message.content === "!leave") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const idBot = client.user?.id;
        if (!idBot) return;

        const canalBot = voiceManager.getVoiceChannelId(canal.guildId, idBot);
        if (!canalBot) {
            await message.reply("No estoy en ningún canal de voz.");
            return;
        }

        if (canal.id !== canalBot) {
            await message.reply("Tienes que estar en el mismo canal que yo.");
            return;
        }

        // Primero se limpia el estado para que el vigilante no ponga otra canción
        limpiarEstado(canal.guildId);
        voiceManager.getConnection(canal.guildId)?.stop();
        voiceManager.leave(canal.guildId);
        await message.reply("He salido del canal. Hasta luego.");
    }

    // Añade una canción a la cola y la reproduce si no suena nada
    if (message.content.startsWith("!play ")) {
        const enlace = message.content.split(" ")[1];
        if (!enlace) {
            await message.reply("Uso: !play <enlace>");
            return;
        }

        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const idComunidad = canal.guildId;
        const cola = obtenerCola(idComunidad);
        cola.push(enlace);

        try {
            const conexion = await voiceManager.join(canal);

            if (pausadas.has(idComunidad)) {
                await message.reply(`Añadida a la cola (posición ${cola.length}). La música está en pausa, usa !resume.`);
            } else if (!conexion.playing) {
                await message.reply("Reproduciendo.");
                await reproducirSiguiente(idComunidad, conexion);
            } else {
                await message.reply(`Añadida a la cola (posición ${cola.length}).`);
            }
        } catch (error) {
            console.error(error);
            await message.reply("No he podido unirme al canal de voz.");
        }
    }

    // Salta la canción actual: al pararla, el vigilante pone la siguiente
    if (message.content === "!skip") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const conexion = voiceManager.getConnection(canal.guildId);
        if (!conexion?.playing) {
            await message.reply("No está sonando nada.");
            return;
        }

        conexion.stop();
        await message.reply("Canción saltada.");
    }

    // Para la música y vacía la cola, sin salir del canal
    if (message.content === "!stop") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const conexion = voiceManager.getConnection(canal.guildId);
        if (!conexion) {
            await message.reply("No estoy en ningún canal de voz.");
            return;
        }

        // Primero se vacía la cola para que el vigilante no ponga otra canción
        limpiarEstado(canal.guildId);
        conexion.stop();
        await message.reply("Música parada y cola vaciada.");
    }

    // Pausa la música: la canción actual vuelve al principio de la cola
    if (message.content === "!pause") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const idComunidad = canal.guildId;
        const conexion = voiceManager.getConnection(idComunidad);
        const actual = actuales.get(idComunidad);

        if (!conexion?.playing || !actual) {
            await message.reply("No está sonando nada.");
            return;
        }

        // Se marca la pausa antes de parar para que el vigilante no avance
        pausadas.add(idComunidad);
        console.log("[debug] pausa registrada en", idComunidad, pausadas); // temporal
        obtenerCola(idComunidad).unshift(actual);
        actuales.delete(idComunidad);
        conexion.stop();
        await message.reply("Música en pausa. Usa !resume para continuar.");
    }

    // Retoma la música (la canción pausada vuelve a empezar desde el principio)
    if (message.content === "!resume") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const idComunidad = canal.guildId;
        console.log("[debug] resume en", idComunidad, pausadas); // temporal
        if (!pausadas.has(idComunidad)) {
            await message.reply("La música no está en pausa.");
            return;
        }

        try {
            const conexion = await voiceManager.join(canal);
            pausadas.delete(idComunidad);
            await message.reply("Retomando la música.");
            await reproducirSiguiente(idComunidad, conexion);
        } catch (error) {
            console.error(error);
            await message.reply("No he podido unirme al canal de voz.");
        }
    }

    // Muestra la canción actual y las pendientes
    if (message.content === "!queue") {
        const canal = await obtenerCanalDeVoz(message);
        if (!canal) return;

        const idComunidad = canal.guildId;
        const actual = actuales.get(idComunidad);
        const cola = colas.get(idComunidad) ?? [];

        if (!actual && cola.length === 0) {
            await message.reply("La cola está vacía.");
            return;
        }

        const lineas: string[] = [];
        if (pausadas.has(idComunidad)) {
            // En pausa, la canción pausada es la primera de la cola
            cola.forEach((enlace, i) => lineas.push(i === 0 ? `En pausa: ${enlace}` : `${i}. ${enlace}`));
        } else {
            if (actual) lineas.push(`Sonando: ${actual}`);
            cola.forEach((enlace, i) => lineas.push(`${i + 1}. ${enlace}`));
        }

        await message.reply(lineas.join("\n"));
    }
});

// ---------- Arranque ----------

await client.login(botToken);