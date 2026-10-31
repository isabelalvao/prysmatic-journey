# Silent Orbit no browser (three.js r187)

Versão para o browser do PC do `Fantasynt-SilentOrbit-Synth.cmd` do Prismatic-Pontos. As mãos foram substituídas pelo olhar: o rato roda a vista (pointer lock) e o centro do ecrã faz o que o apontar das mãos fazia, tanto na imagem como no som. Não há modelo de mãos, comandos, retícula, eco nem efeitos visuais nas mãos.

Há também um modo VR (WebXR) para o browser do Quest, com o hand tracking do original: ver [VR no Quest](#vr-no-quest-com-as-mãos).

## Como abrir

- `Iniciar.cmd`: instala as dependências na primeira vez (precisa do Node.js) e abre `http://localhost:5180`.
- `Publicar.cmd`: gera a versão estática em `dist\` e pré-visualiza-a em `http://localhost:5181`. A pasta `dist\` pode ir para qualquer servidor HTTPS (o pointer lock e o AudioWorklet só funcionam em `localhost` ou HTTPS).

O ecrã inicial carrega tudo antes de deixar começar: geometria e instâncias (`scene.bin`, 4,5 MB), a música (Opus 9,8 MB, ou AAC no Safari) já descodificada, as texturas e os shaders, que são compilados ao desenhar por trás do ecrã de carregamento um momento de cada fase da obra. Só então aparece o botão **Começar**, que inicia o áudio.

Controlo: mover o rato olha à volta (vertical limitado a ±80°); clicar volta a prender o rato depois de `Esc`. As teclas `1` a `4` mudam o esquema de cor, com uma transição de 4 s: `1` Original (mais intenso), `2` Esmeralda (verde-água néon), `3` Néon (magenta e violeta), `4` Cidade (âmbar com acentos magenta). Cada esquema dá cor própria a cones, cristais, anéis, cometas, nevoeiro, céu e fundo (`src/theme.js`), e a composição junta uma luz de fundo na cor do esquema. Usar auscultadores: as notas vêm da direção para onde se olha (HRTF).

Opções de URL para testar: `?debug` mostra tempo, fps, desenhos e o episódio da resposta, e ativa `Espaço` (pausa) e `←`/`→` (±10 s); `?t=120` começa aos 120 s; `?scale=1` fixa a resolução interna (por omissão segue o ecrã, até 2×).

## VR no Quest (com as mãos)

1. No PC, abrir `Iniciar-VR.cmd`. Gera a versão estática e serve-a em HTTPS na rede local (porta 5443), porque o browser do Quest só deixa entrar em WebXR em HTTPS. Na primeira vez o Windows pode pedir para deixar o Node.js usar redes privadas: aceitar.
2. No Quest (mesma rede Wi-Fi), abrir no browser o endereço `Network` que aparece na janela, por exemplo `https://192.168.1.20:5443`. O certificado é local, por isso o browser avisa na primeira vez: «Avançadas» → continuar.
3. Esperar pelo carregamento e carregar em **Entrar em VR**. O botão só aparece quando o browser suporta WebXR.

O que as mãos fazem, como em `Fantasynt-SilentOrbit-Synth.cmd` (`--vr --hand-snap --synth --hand-response --point-synth`):

- **Apontar**: o raio vai da cabeça à palma (`hand_response.cpp`). A força cresce com o braço esticado (35 a 55 cm na horizontal) e com a mão aberta. As formas respondem como ao olhar, e cada mão toca a sua voz (`point_music.cpp`): marimba na esquerda e sino na direita, a altura pela elevação da mão, o som a 3 m na direção apontada.
- **Eco dourado**: dois a quatro gestos secos (a palma passa de parada a mais de 1 m/s) seguidos de uma pausa fazem as formas repetir a frase. O estilo do eco alterna entre igual, variado e outra família.
- **Mãos em pontos** (`make_hand_dots`) na cor predominante da cena (segue o esquema de cor), a desvanecer para o pulso, com o **rasto** de pontinhos das pontas dos dedos (`hand_trail.cpp`).
- **Estalo dos dedos** (`hand_snap.cpp`): o polegar encosta ao médio e o médio salta para a palma. Faz faíscas (`snap_geometry.cpp`) e um «sopro» de dois dentes de serra filtrados (`hand_synth.cpp`), com a nota pela altura da mão face à cabeça.
- Comandos em vez de mãos também apontam, com o gatilho.

As teclas de cor não estão disponíveis dentro do óculos: escolher o esquema no ecrã inicial antes de entrar.

**Desempenho**: o original corria no PC. Aqui tudo corre no Quest, com cerca de 1000 desenhos por olho. O modo VR já usa menos resolução e não usa MSAA. `?vrscale=0.6` baixa mais a resolução (0,4 a 1; por omissão 0,75). Juntar ao endereço, por exemplo `https://192.168.1.20:5443/?vrscale=0.6`.

## O olhar no lugar das mãos

Como as mãos na versão Synth (`--hand-response --point-synth`), com estas escolhas:

- **Resposta visual**: uma só «mão» aponta dos olhos para o centro do ecrã com força 1 (cone de ~10°, como no original). O perfil de resposta (`response_profile.cpp`) e a memória do toque (`point_trail.cpp`, 1,5 s) foram portados tal como estão, no degrau subtil (`hand_response.subtle_scale` 0,45). Um episódio novo (que troca a propriedade dominante de cada família) começa quando o rato volta a mexer depois de parado ou quando o olhar se afasta mais de 30° de onde o episódio começou.
- **Música por olhar**: `point_music.cpp` portado. Notas na grelha de semicolcheias a 112 BPM, na pentatónica de ré menor filtrada pelos acordes de `chords.json`; altura pela elevação do olhar (-35° a +40° → duas oitavas). Olhar para a esquerda toca a marimba (ré 4), para a direita o sino (ré 5). Uma nota por semínima enquanto se olha, mais uma sempre que a nota muda. Só toca enquanto o olhar está ativo, isto é, até 1,5 s depois de o rato parar.
- **Som**: o Mallet do vr-synth (DaisySP ModalVoice, ressonador de 24 modos, Svf passa-baixo, saturação tanh) está num AudioWorklet (`src/synth.worklet.js`), com os mesmos timbres, cortes e ganhos. Cada voz passa por um PannerNode HRTF. O ouvinte fica virado para o percurso e a nota vem de 3 m na direção do olhar. As notas são agendadas no relógio da placa de som para caírem na semicolcheia exata.
- **Relógio**: a imagem segue o tempo da música que se está a ouvir (`AudioContext.getOutputTimestamp`), como no original segue o áudio.

## Como está feito

Os dados estáticos vêm do próprio código C++ do Prismatic-Pontos, para serem iguais aos do original (o `mt19937` é determinístico): `tools/exporter/web_export.cpp` liga-se às fontes de `src/render`, `src/config` e `src/audio` e escreve `public/data/manifest.json` e `scene.bin` (malhas em pontos, instâncias de cada grupo, extensões, túnel, envelope dos graves). A lógica de cada frame (`renderer.cpp`, `art_direction`, `sequence`, `surface_choreography`) está portada em `src/direction.js` e `src/world.js`, e os shaders bgfx são convertidos para GLSL ES 3.00 por `tools/convert_shaders.py` (`src/shaders.gen.js`). O three.js r187 só executa: RawShaderMaterial, instâncias, reflexo do chão, cena HDR com MSAA, bloom a meia resolução e composição (céu, chuva, ACES, gama, vinheta).

| Ficheiro | O que faz |
| --- | --- |
| `src/main.js` | preload, botão Começar, pointer lock, ciclo de desenho |
| `src/world.js` | port do renderer: listas de desenho das duas vistas e pós-processamento |
| `src/direction.js` | composição, câmara, parâmetros visuais, túnel |
| `src/gaze.js` | olhar → `u_point`, `u_respond`, `u_trail` |
| `src/xr.js` | sessão WebXR e matrizes de cada olho (`make_eye_matrices`) |
| `src/hands.js` | mãos em VR: apontar, eco, notas |
| `src/handvisuals.js` | mãos em pontos, rasto, estalo e faíscas |
| `src/audio.js` | música, relógio e notas do olhar |
| `src/synth.worklet.js` | marimba e sino (vr-synth Mallet) |

### Regenerar os dados

Se a configuração ou o código do Prismatic-Pontos mudarem:

1. `tools/exporter/build.sh <Prismatic-Pontos> <pasta com nlohmann/json.hpp>` (g++ 13+, por exemplo no WSL) compila o exportador e escreve `public/data/`.
2. `python tools/convert_shaders.py <Prismatic-Pontos>/shaders src/shaders.gen.js` volta a converter os shaders.
3. `src/curves.js` foi gerado a partir de `src/render/sequence_curves.hpp`, e `src/direction.js` contém os mesmos números que `art_direction.cpp`. Uma alteração nesses ficheiros tem de ser repetida aqui à mão.
4. Música: `ffmpeg -i silent-orbit.wav -c:a libopus -b:a 192k public/audio/silent-orbit.ogg` e `ffmpeg -i silent-orbit.wav -c:a aac -b:a 224k public/audio/silent-orbit.m4a`.
