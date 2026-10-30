"""Converte os shaders bgfx (.sc) do Prismatic-Pontos para GLSL ES 3.00 (three.js RawShaderMaterial).

Uso: python tools/convert_shaders.py <pasta shaders do Prismatic-Pontos> src/shaders.gen.js
As diferenças de convenção (origem das texturas em OpenGL, cor da família por desenho) são tratadas aqui, para os
shaders continuarem iguais ao original em tudo o resto.
"""
import re
import sys
from pathlib import Path

VARYINGS = {}
ATTRIBUTES = {}


def read_varyings(path):
    for line in Path(path).read_text().splitlines():
        m = re.match(r'\s*(vec\d|float)\s+(\w+)\s*:', line)
        if m:
            (ATTRIBUTES if m.group(2).startswith(('a_', 'i_')) else VARYINGS)[m.group(2)] = m.group(1)


def replace_mul(src):
    out, i = [], 0
    while True:
        j = src.find('mul(', i)
        if j < 0 or (j > 0 and (src[j - 1].isalnum() or src[j - 1] == '_')):
            if j < 0:
                out.append(src[i:])
                return ''.join(out)
            out.append(src[i:j + 4]); i = j + 4; continue
        out.append(src[i:j])
        depth, k, comma = 1, j + 4, None
        while depth:
            c = src[k]
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            elif c == ',' and depth == 1 and comma is None:
                comma = k
            k += 1
        a, b = src[j + 4:comma], src[comma + 1:k - 1]
        out.append('((' + replace_mul(a) + ')*(' + replace_mul(b) + '))')
        i = k


HEADER = '''precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
'''


def convert(path, vertex):
    text = Path(path).read_text()
    decl = []
    body = []
    for line in text.splitlines():
        if line.startswith('$input'):
            names = [n.strip() for n in line[6:].split(',')]
            for n in names:
                if vertex:
                    decl.append('in %s %s;' % (ATTRIBUTES[n], n))
                else:
                    decl.append('in %s %s;' % (VARYINGS[n], n))
            continue
        if line.startswith('$output'):
            for n in [n.strip() for n in line[7:].split(',')]:
                decl.append('out %s %s;' % (VARYINGS[n], n))
            continue
        if line.startswith('#include'):
            continue
        m = re.match(r'SAMPLER2D\((\w+),\s*\d+\);', line)
        if m:
            decl.append('uniform sampler2D %s;' % m.group(1))
            continue
        body.append(line)
    src = '\n'.join(body)
    src = replace_mul(src)
    # Palavras reservadas em GLSL ES 3.00 que o HLSL/bgfx aceita como nomes.
    src = re.sub(r'\b(active|input|output|filter|sample|common|partition|packed|smooth|flat|centroid|patch|superp|noperspective|half|fixed|unsigned|namespace|using|external|interface|union|enum|cast|goto|inline|class|public|static|extern|template|this|resource)\b', r'\1_', src)
    src = src.replace('mtxFromCols(', 'mat4(').replace('texture2D(', 'texture(').replace('atan2(', 'atan(')
    if not vertex:
        src = src.replace('gl_FragColor', 'fragColor')
        decl.append('out vec4 fragColor;')
    return HEADER + '\n'.join(decl) + '\n' + src


def main():
    root, target = Path(sys.argv[1]), Path(sys.argv[2])
    read_varyings(root / 'varying.def.sc')
    shaders = {}
    for name in ['vs_scene', 'vs_opening']:
        shaders[name] = convert(root / (name + '.sc'), True)
    for name in ['fs_scene', 'fs_opening', 'fs_ground', 'fs_extract', 'fs_blur', 'fs_composite']:
        shaders[name] = convert(root / (name + '.sc'), False)
    # Cor e emissão da família por desenho (no original, u_tuning[20] é reescrito em cada grupo da Opening).
    s = shaders['fs_opening']
    s = s.replace('uniform vec4 u_tuning[22];', 'uniform vec4 u_tuning[22];\nuniform vec4 u_family;')
    shaders['fs_opening'] = s.replace('u_tuning[20]', 'u_family')
    # OpenGL: a textura do reflexo tem a origem em baixo; as perturbações em y trocam de sinal.
    g = shaders['fs_ground']
    g = g.replace('uv.y = 1.0-uv.y;', '')
    g = g.replace('vec2 disturbance = vec2(sin(v_world.z*0.009),cos(v_world.x*0.007))*u_tuning[17].z;',
                  'vec2 disturbance = vec2(sin(v_world.z*0.009),-cos(v_world.x*0.007))*u_tuning[17].z;')
    g = g.replace('vec2 roughness = vec2(u_tuning[17].w,u_tuning[18].x);', 'vec2 roughness = vec2(u_tuning[17].w,-u_tuning[18].x);')
    shaders['fs_ground'] = g
    # Passagens de ecrã inteiro: v_uv chega em OpenGL (origem em baixo); o céu e a vinheta usam a convenção D3D.
    for name in ['fs_extract', 'fs_blur', 'fs_composite']:
        shaders[name] = shaders[name].replace('in vec2 v_uv;', 'in vec2 v_uv;\nin vec2 v_d3d;')
    c = shaders['fs_composite']
    c = c.replace('mul(u_sky,vec4(v_uv*2.0-1.0,1.0,0.0))', '')
    c = c.replace('((u_sky)*(vec4(v_uv*2.0-1.0,1.0,0.0)))', '((u_sky)*(vec4(v_d3d*2.0-1.0,1.0,0.0)))')
    c = c.replace('length((v_uv-0.5)*u_tuning[15].w)', 'length((v_d3d-0.5)*u_tuning[15].w)')
    c = c.replace('timer_overlay(color*vignette,v_uv)', 'color*vignette')
    shaders['fs_composite'] = c
    shaders['vs_quad'] = '''precision highp float;
in vec3 a_position;
out vec2 v_uv;
out vec2 v_d3d;
void main()
{
    gl_Position = vec4(a_position.xy,0.0,1.0);
    v_uv = a_position.xy*0.5+0.5;
    v_d3d = vec2(v_uv.x,1.0-v_uv.y);
}
'''
    lines = ['// Gerado por tools/convert_shaders.py a partir de shaders/*.sc do Prismatic-Pontos; não editar à mão.']
    for name, code in shaders.items():
        lines.append('export const %s = %s;' % (name, '`' + code.replace('`', '\\`') + '`'))
    target.write_text('\n'.join(lines) + '\n')


if __name__ == '__main__':
    main()
