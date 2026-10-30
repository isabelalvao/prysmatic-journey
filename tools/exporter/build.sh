#!/bin/sh
# Compila o exportador contra o código do Prismatic-Pontos (g++ 13+, C++20) e gera public/data/.
# Uso: tools/exporter/build.sh <pasta do Prismatic-Pontos> [pasta com nlohmann/json.hpp]
set -e
PO=${1:?pasta do Prismatic-Pontos}
JSON=${2:-$PO/third}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$(mktemp -d)
for f in render/opening_scene render/art_direction render/mini_poles render/dot_geometry render/geometry \
         render/landscape_geometry render/landscape_surfaces render/tunnel_geometry render/spectral_geometry \
         render/surface_geometry render/sequence render/surface_choreography config/visual_config \
         control/protocol audio/beat_envelope; do
  g++ -std=c++20 -O2 -c "$PO/src/$f.cpp" -I "$PO/src" -I "$JSON" -I "$HERE" -o "$OUT/$(echo $f | tr / _).o"
done
g++ -std=c++20 -O2 -c "$HERE/web_export.cpp" -I "$PO/src" -I "$JSON" -I "$HERE" -o "$OUT/web_export.o"
g++ "$OUT"/*.o -o "$OUT/web_export"
"$OUT/web_export" "$PO" "$PO/visual-config.silent-orbit.json" "$PO/assets/audio/silent-orbit.wav" "$HERE/../../public/data"
cp "$PO/assets/audio/silent-orbit.chords.json" "$HERE/../../public/data/chords.json"
echo "Dados escritos em public/data/"
