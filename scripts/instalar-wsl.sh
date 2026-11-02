#!/usr/bin/env bash
# Prepares a WSL2 (Ubuntu) with Docker Desktop to run the factory. Safe to run again: every step checks first.
# It stores no secret in the repository: the Claude token goes to ~/.config/limonia/claude-credencial (mode 600).
#
#   bash scripts/instalar-wsl.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
root="$(pwd -P)"
imagen="limonia-agente:dev"
credencial="${LIMONIA_CREDENCIAL:-$HOME/.config/limonia/claude-credencial}"

paso() { printf '\n== %s\n' "$1"; }
falla() { printf '✗ %s\n' "$1" >&2; exit 1; }

paso "1. Entorno"
if ! grep -qi microsoft /proc/version 2>/dev/null && [ -z "${WSL_DISTRO_NAME:-}" ]; then
  printf 'Aviso: esto no parece WSL. Sigo igualmente (en Linux nativo también funciona).\n'
fi
case "$root" in
  /mnt/[a-zA-Z]|/mnt/[a-zA-Z]/*)
    falla "El repositorio está en el disco de Windows ($root). Clónalo dentro de WSL: cd ~ && git clone <url> && cd charla-factory-demo && bash scripts/instalar-wsl.sh" ;;
esac
printf '✓ Repositorio en %s\n' "$root"

paso "2. Docker"
if ! command -v docker >/dev/null 2>&1 || ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  cat >&2 <<'MSG'
✗ Docker no responde desde esta Ubuntu. Actívalo así:
  1. Instala y abre Docker Desktop en Windows (https://www.docker.com/products/docker-desktop/).
  2. Settings → General: marca «Use the WSL 2 based engine».
  3. Settings → Resources → WSL integration: activa tu Ubuntu y pulsa «Apply & restart».
  4. Cierra y abre de nuevo esta terminal de Ubuntu y prueba: docker version
Cuando funcione, vuelve a ejecutar este script.
MSG
  exit 1
fi
printf '✓ Docker %s\n' "$(docker version --format '{{.Server.Version}}')"

paso "3. Node $(cat .node-version)"
node_esperado="$(tr -d '[:space:]' < .node-version)"
if command -v node >/dev/null 2>&1 && [[ "$(node -v | sed 's/^v//')" == "$node_esperado" || "$(node -v | sed 's/^v//')" == "$node_esperado".* ]]; then
  printf '✓ Node %s\n' "$(node -v)"
else
  # The project does not install Node itself, and piping a download into a shell is not done without asking: print it.
  cat >&2 <<MSG
✗ Falta Node $node_esperado (ahora: $(command -v node >/dev/null 2>&1 && node -v || echo 'no instalado')). Instálalo tú con nvm, copiando estas líneas:
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
  (cierra y abre la terminal)
  nvm install $node_esperado && nvm use $node_esperado
Después vuelve a ejecutar este script.
MSG
  exit 1
fi

paso "4. Dependencias (npm ci)"
npm ci

paso "5. Imagen del agente ($imagen)"
npm run agente:imagen

paso "6. Red de los agentes"
npm run proxy:red

paso "7. Credencial de Claude"
if [ -f "$credencial" ] && [ -s "$credencial" ]; then
  chmod 600 "$credencial"
  printf '✓ Ya existe %s (no la toco)\n' "$credencial"
else
  cat <<MSG
Falta la credencial de Claude. Se crea con «claude setup-token» (necesita una suscripción de Claude y abrir un enlace en el navegador).
Para no instalar nada más, puedo ejecutarlo dentro de la imagen del agente:
  docker run --rm -it $imagen claude setup-token
Al terminar te da un token que empieza por sk-ant-oat…; lo pegarás aquí (no se ve al escribir) y se guarda en $credencial.
MSG
  if [ -t 0 ]; then
    read -r -p "¿Ejecuto «claude setup-token» ahora? [s/N] " respuesta
    case "$respuesta" in
      s|S|si|sí|SI|Sí) docker run --rm -it "$imagen" claude setup-token || true ;;
    esac
    read -r -s -p "Pega el token y pulsa Intro (vacío para saltar): " token
    printf '\n'
    token="$(printf '%s' "$token" | tr -d '[:space:]')"
    if [ -n "$token" ]; then
      case "$token" in
        sk-ant-oat*|sk-ant-api*) ;;
        *) falla "Eso no parece un token (debe empezar por sk-ant-oat o sk-ant-api). No se ha guardado nada." ;;
      esac
      umask 077
      mkdir -p "$(dirname "$credencial")"
      chmod 700 "$(dirname "$credencial")"
      printf '%s\n' "$token" > "$credencial"
      chmod 600 "$credencial"
      unset token
      printf '✓ Guardado en %s (modo 600)\n' "$credencial"
    else
      printf 'Saltado: sin credencial el proxy no arrancará. Vuelve a ejecutar este script cuando tengas el token.\n'
    fi
  else
    printf 'Sin terminal interactiva: ejecuta este script a mano para pegar el token.\n'
  fi
fi

paso "8. GitHub (gh)"
if ! command -v gh >/dev/null 2>&1; then
  cat >&2 <<'MSG'
✗ Falta gh (GitHub CLI). Instálalo con:
  sudo apt update && sudo apt install -y gh
  (si tu Ubuntu no lo trae, sigue https://github.com/cli/cli/blob/trunk/docs/install_linux.md)
Después vuelve a ejecutar este script.
MSG
  exit 1
fi
if gh auth status >/dev/null 2>&1; then
  printf '✓ gh con la sesión iniciada\n'
else
  printf 'Inicia sesión con la cuenta dueña del repositorio:\n'
  gh auth login
fi

paso "9. Comprobación final"
npm run comprobar
