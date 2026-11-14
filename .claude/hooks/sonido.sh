#!/usr/bin/env bash
# Reproduce un sonido corto para avisar al dueño. Uso: sonido.sh terminado|atencion
# Portable: macOS (afplay/osascript), Linux (paplay/aplay/canberra), Windows (PowerShell) y,
# si nada de eso existe (p. ej. un contenedor en la nube sin audio), la campana de la terminal.
# Nunca falla: un aviso que no suena no debe bloquear a Claude.
tipo="${1:-terminado}"
{
  case "$(uname -s 2>/dev/null)" in
    Darwin)
      if [ "$tipo" = "atencion" ]; then s=/System/Library/Sounds/Ping.aiff; else s=/System/Library/Sounds/Glass.aiff; fi
      if command -v afplay >/dev/null 2>&1 && [ -f "$s" ]; then afplay "$s" && exit 0; fi
      osascript -e 'beep 1' && exit 0
      ;;
    Linux)
      if [ "$tipo" = "atencion" ]; then id=dialog-warning; f=/usr/share/sounds/freedesktop/stereo/dialog-warning.oga
      else id=complete; f=/usr/share/sounds/freedesktop/stereo/complete.oga; fi
      if command -v canberra-gtk-play >/dev/null 2>&1; then canberra-gtk-play -i "$id" && exit 0; fi
      if command -v paplay >/dev/null 2>&1 && [ -f "$f" ]; then paplay "$f" && exit 0; fi
      if command -v aplay >/dev/null 2>&1 && [ -f /usr/share/sounds/alsa/Front_Center.wav ]; then aplay -q /usr/share/sounds/alsa/Front_Center.wav && exit 0; fi
      ;;
    MINGW*|MSYS*|CYGWIN*)
      powershell.exe -NoProfile -Command "[System.Media.SystemSounds]::$( [ "$tipo" = atencion ] && echo Exclamation || echo Asterisk ).Play(); Start-Sleep -Milliseconds 600" && exit 0
      ;;
  esac
  # Último recurso: campana de la terminal (suena si el emulador de terminal la tiene activada).
  printf '\a' > /dev/tty
} >/dev/null 2>&1
exit 0
