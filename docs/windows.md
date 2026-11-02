# La fábrica en un PC con Windows (WSL2 + Docker Desktop)

Guía paso a paso para quien nunca lo ha hecho. Al final tendrás la fábrica de LIMONIA funcionando en tu Windows: los agentes trabajan dentro de contenedores y los cambios llegan a GitHub.

Todo lo que sigue se escribe en una terminal de **Ubuntu (WSL)**, salvo los pasos 1 y 2, que son de Windows. Si un paso falla, mira «Si algo falla» al final.

## Lo que necesitas antes

- Windows 10 (22H2) o Windows 11, con la virtualización activada en la BIOS (casi siempre lo está).
- Unos 15 GB libres y conexión a internet.
- Una cuenta de GitHub que sea **dueña del repositorio** (la misma con la que harás `gh auth login`).
- Una suscripción de Claude (para el token del paso 5).

## 1. Activa WSL2 con Ubuntu (una vez, en Windows)

1. Abre **PowerShell como administrador** (botón derecho en Inicio → «Terminal (administrador)»).
2. Ejecuta:

   ```powershell
   wsl --install -d Ubuntu
   ```

3. Reinicia Windows si te lo pide. Al volver se abre Ubuntu y te pide un **usuario** y una **contraseña** de Linux (no tienen que ser los de Windows; apúntalos).
4. Comprueba que es la versión 2: en PowerShell, `wsl -l -v` debe mostrar `Ubuntu` con `VERSION 2`.

## 2. Instala Docker Desktop con integración WSL (una vez, en Windows)

1. Descarga e instala Docker Desktop: <https://www.docker.com/products/docker-desktop/>. Déjalo marcado «Use WSL 2 instead of Hyper-V».
2. Ábrelo. En **Settings → General** comprueba «Use the WSL 2 based engine».
3. En **Settings → Resources → WSL integration** activa **Ubuntu** y pulsa **Apply & restart**.
4. Abre una terminal de Ubuntu (menú Inicio → Ubuntu) y prueba:

   ```bash
   docker version
   ```

   Debe mostrar «Client» y «Server». Si dice que no se puede conectar, Docker Desktop no está abierto o falta el paso 3.

## 3. Descarga el repositorio **dentro de WSL**

> No lo clones en `C:\…` (en WSL, `/mnt/c/…`): allí fallan los permisos de ficheros y los montajes de Docker. Hazlo en tu carpeta de Ubuntu.

En la terminal de Ubuntu:

```bash
cd ~
sudo apt update && sudo apt install -y git
git clone https://github.com/<dueño>/charla-factory-demo.git
cd charla-factory-demo
```

(sustituye `<dueño>` por la cuenta dueña del repositorio).

## 4. Ejecuta el instalador

```bash
bash scripts/instalar-wsl.sh
```

Es seguro repetirlo: cada paso mira primero si ya está hecho. El instalador:

1. Comprueba que estás en WSL y fuera de `/mnt/c`.
2. Comprueba que Docker responde (si no, te dice cómo activar la integración).
3. Comprueba Node. **Si falta, no lo instala por su cuenta**: te imprime las líneas exactas (con `nvm`) para que las copies tú; después vuelve a ejecutar el instalador.
4. Ejecuta `npm ci`, construye la imagen del agente (`npm run agente:imagen`, tarda unos minutos la primera vez) y crea la red de los agentes (`npm run proxy:red`).
5. Pide la credencial de Claude (paso siguiente).
6. Comprueba `gh` y, si hace falta, lanza `gh auth login`.
7. Termina con `npm run comprobar`.

### 5. El token de Claude

Si no hay credencial, el instalador te ofrece ejecutar `claude setup-token` **dentro de la imagen del agente** (no hay que instalar nada más):

```bash
docker run --rm -it limonia-agente:dev claude setup-token
```

Abre el enlace que te muestra en el navegador de Windows, acepta, y copia el token (empieza por `sk-ant-oat…`). El instalador te lo pide sin mostrarlo al teclear («Pega el token») y lo guarda en `~/.config/limonia/claude-credencial` con permisos 600, una sola copia. **Nunca** lo pegues en el repositorio, en un chat ni en una issue.

### 6. `gh`

Si falta: `sudo apt update && sudo apt install -y gh`. Inicia sesión con `gh auth login` (GitHub.com → HTTPS → «Login with a web browser»). La cuenta debe ser la dueña del repositorio; `npm run comprobar` lo verifica.

## 5. Comprueba que todo está en verde

```bash
npm run comprobar
```

Cada línea empieza por ✓ (bien), ✗ (hay que arreglarlo; debajo sale el comando exacto) o – (informativo). Hasta que no haya ✗ no sigas.

## 6. Arranca la fábrica

```bash
npm run demo
```

Hace tres cosas: repite las comprobaciones (y no arranca si alguna falla), arranca el proxy del modelo y, cuando responde, arranca la fábrica (`npm run fabrica`). Por defecto coge solo las peticiones **de prueba** (las que creas tú con `npm run tarea`).

**Para parar**: pulsa `Ctrl+C` **una vez**. La fábrica deja de coger tareas y termina las que lleva; cuando acaba, se para el proxy. Si no quieres esperar, pulsa `Ctrl+C` otra vez: la fábrica cancela los agentes, devuelve las tareas a la cola y después se para el proxy.

### Prueba una petición

Abre una **segunda** terminal de Ubuntu, entra en la carpeta y crea una petición de prueba:

```bash
cd ~/charla-factory-demo
npm run tarea -- "Una campaña de naranjas de Murcia para este verano"
```

Te dice el número de la tarea (por ejemplo `#130`). En el navegador abre `https://<la web>/tarea/?n=130` y verás pasar las estaciones (agente, revisores, comprobación, aprobador) y qué está haciendo ahora. En la primera terminal ves lo mismo en texto. Una tarea tarda unos 3 minutos de principio a fin.

## 7. El día de la charla

1. Antes: enchufa el portátil, desactiva la suspensión (ver abajo) y ejecuta `npm run comprobar`.
2. Arranca para el público:

   ```bash
   npm run demo -- --origen web
   ```

   `--origen web` hace que la fábrica coja las peticiones del formulario público. Cualquier opción de `npm run fabrica` se pasa tal cual (`--paralelo 2`, `--modelo …`).
3. Abre el formulario de la web, rellénalo como lo haría el público y proyecta `/factory/` (el tablero) o `/tarea/?n=N`.

## 8. Después de la charla

1. Pulsa `Ctrl+C` en la terminal de `npm run demo` (una vez; espera a que termine, o dos si no quieres esperar).
2. Comprueba que no quedan contenedores: `docker ps` (no debe haber `limonia-…`; si queda alguno, `docker rm -f limonia-proxy`).
3. Si quieres dejar la demo como al principio: `npm run reset-demo` (muestra qué haría; con `-- --apply` lo hace).
4. Para quitar el token del PC: `rm ~/.config/limonia/claude-credencial` (y revócalo en tu cuenta de Claude si el PC no es tuyo).

## Qué hace `demo` con el directorio del proxy (XDG_RUNTIME_DIR)

El proxy y la fábrica hablan por un socket que vive en `$XDG_RUNTIME_DIR/limonia/`. Un WSL sin systemd a veces no define esa variable. En ese caso `npm run comprobar` y `npm run demo` usan `/tmp/limonia-<tu uid>` (lo crean con permisos 700 y lo pasan a los dos procesos). Si ese directorio ya existe con otro dueño o permisos distintos, se **niegan a usarlo** y te dicen qué mirar (`ls -ld /tmp/limonia-1000`). Si lanzas `npm run proxy` y `npm run fabrica` por separado (sin `demo`), exporta antes la variable: `export XDG_RUNTIME_DIR=/tmp/limonia-$(id -u)` (y crea el directorio con `mkdir -m 700`).

## Si algo falla

**`docker: Cannot connect to the Docker daemon` / `comprobar` dice «Docker no responde».** Docker Desktop no está abierto, o falta la integración: Docker Desktop → Settings → Resources → WSL integration → activa Ubuntu → Apply & restart. Cierra y reabre la terminal de Ubuntu. Prueba `docker version`.

**`comprobar` dice que el repositorio está en `/mnt/c`.** Clónalo en `~` (paso 3) y trabaja siempre desde ahí. Borra la copia de `C:\`.

**El proxy da 401 / «authentication» / los agentes terminan sin trabajar.** El token es inválido o ha caducado. Genera uno nuevo: `docker run --rm -it limonia-agente:dev claude setup-token`, y vuelve a ejecutar `bash scripts/instalar-wsl.sh` tras borrar el antiguo (`rm ~/.config/limonia/claude-credencial`). Reinicia `npm run demo`.

**«credential file … has a loose mode» o `comprobar` dice permisos distintos de 600.** `chmod 600 ~/.config/limonia/claude-credencial`. Si vuelve a salir 777 o 755, el fichero está en el disco de Windows: muévelo a `~/.config/limonia/`.

**El proxy no arranca o `demo` dice «el proxy no responde».** Mira el mensaje que sale justo encima. Causas habituales: credencial mal (arriba), Docker parado, o un `limonia-proxy` antiguo: `docker rm -f limonia-proxy` y repite. Revisa los logs: `docker logs limonia-proxy`.

**Error con el socket del proxy / «ENOENT … proxy-admin.sock» / `comprobar` rojo en «Directorio del socket».** Mira `ls -ld /tmp/limonia-$(id -u)`: debe ser tuyo y de permisos `drwx------`. Si es de otro usuario o tiene otros permisos, bórralo si es tuyo (`rm -r`) y repite. No lances `npm run proxy` y `npm run fabrica` con valores distintos de `XDG_RUNTIME_DIR`: usa `npm run demo`.

**«ya hay una fábrica en marcha».** Hay otra `npm run fabrica` o `demo` abierta (mira otras terminales). Si seguro que no, `ps aux | grep fabrica`; el candado caduca solo cuando ese proceso no existe.

**Windows se suspende y la fábrica se queda parada.** Ajustes → Sistema → Inicio/apagado y suspensión → «Nunca» (con el cable enchufado). Si se suspendió durante una tarea: `Ctrl+C` y volver a ejecutar `npm run demo`; las tareas sin terminar vuelven a la cola. Si la hora quedó desfasada tras despertar: `wsl --shutdown` en PowerShell y reabrir Ubuntu.

**Cortafuegos o VPN.** Con una VPN de empresa Docker puede dejar de resolver nombres (error al construir la imagen o «could not resolve host»): prueba sin VPN, o en Docker Desktop → Settings → Docker Engine añade `"dns": ["8.8.8.8"]`. Un cortafuegos debe dejar salir a `api.anthropic.com`, `github.com`, `registry.npmjs.org` y a Docker Hub. Si Windows pregunta si permites a «Docker Desktop Backend» en la red, acepta en redes privadas.

**`gh` dice que estás como otra cuenta.** `gh auth switch` o `gh auth login` con la cuenta dueña del repositorio (`comprobar` te dice cuál debe ser).

**Cualquier otra cosa.** Ejecuta `npm run comprobar` y haz lo que diga la primera línea con ✗.
