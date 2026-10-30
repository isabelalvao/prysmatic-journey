// Gerado por tools/convert_shaders.py a partir de shaders/*.sc do Prismatic-Pontos; não editar à mão.
export const vs_scene = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec3 a_position;
in vec3 a_normal;
in vec2 a_texcoord0;
in vec4 i_data0;
in vec4 i_data1;
in vec4 i_data2;
in vec4 i_data3;
in vec4 i_data4;
out vec3 v_world;
out vec3 v_local;
out vec3 v_normal;
out vec4 v_meta;
out vec4 v_clip;
out vec2 v_pattern;
out vec2 v_response;
out vec4 v_dot;
out vec4 v_tint;
uniform vec4 u_scene;
uniform vec4 u_clock;
uniform vec4 u_style;
uniform vec4 u_point[5];
// Botões da resposta (src/interaction/response_profile.*): amplitudes por família e eco.
uniform vec4 u_respond[17];
// Memória do toque (src/interaction/point_trail.*): direções apontadas recentes de cada mão.
uniform vec4 u_trail[25];
uniform vec4 u_layout;
// Versão de pontos (src/render/dot_geometry.*): [0] raio Opening (cm), brilho mínimo Opening, suavidade,
// brilho mínimo extensão; [1..2] forma por família Opening ([2].w: raio da extensão, cm); [3..6] forma por tipo
// da extensão (0 redondo, 1 quadrado); [7] pirâmides (brilho mínimo, px mínimos), queda antes do túnel (ligada,
// desencontro); [8] cometas (rasto) e desvanecimento com a distância; [9] cometas (ligados), brilho dos círculos ao ritmo
// (instâncias marcadas com i_data0.w=1 pela CPU).
uniform vec4 u_dots[11];
float dot_shape(float index)
{
    int i=int(clamp(index,0.0,23.0)+0.5);
    vec4 v=u_dots[1+i/4];
    int c=i-4*(i/4);
    return c==0?v.x:c==1?v.y:c==2?v.z:v.w;
}
// Cada ponto chega como quatro vértices na mesma posição; a normal com comprimento 2–5 indica o
// canto, que se afasta no plano da imagem: o ponto tem sempre o mesmo tamanho e fica virado para quem vê.
vec3 expand_dot(float code,float shape,float min_pixels,float size,inout vec4 position,inout float gain)
{
    if(code<1.5) return vec3(0.0,0.0,-1.0);
    float corner=floor(code+0.5)-2.0;
    vec2 offset=vec2(corner>0.5 && corner<2.5?1.0:-1.0,corner>1.5?1.0:-1.0);
    // Anéis: ao longe o ponto não desce abaixo de min_pixels de diâmetro (menos de um pixel desaparecia).
    // Só nos anéis: alargar todos os pontos distantes custa demasiados fragmentos.
    vec2 world_size=u_dots[2].w*vec2(u_proj[0][0],u_proj[1][1]);
    vec2 pixel_size=vec2(min_pixels/max(u_viewRect.z,1.0),min_pixels/max(u_viewRect.w,1.0))*position.w;
    // O tamanho mínimo no ecrã não se multiplica pelo LOD; um ponto alargado só pelo mínimo perde brilho na proporção
    // da área ganha, para a luz total não aumentar (bordo suave no fragment shader).
    vec2 grown=max(world_size*size,pixel_size);
    position.xy+=offset*grown;
    vec2 ratio=world_size*size/max(grown,vec2(1e-6,1e-6));
    gain=clamp(ratio.x*ratio.y,0.15,1.0);
    return vec3(offset,shape);
}
// Cometas a passar (src/render/renderer.cpp, update_comets): até 4 cápsulas [3k] cabeça e força, [3k+1] onde a cabeça
// estava há comet_tint_decay_seconds, [3k+2] cor; [12] raio (cm) e intensidade máxima. As estruturas tomam a cor do
// cometa aos poucos: perto da cabeça a cor sobe depressa e, ao longo do rasto, desaparece suavemente.
uniform vec4 u_comets[13];
vec4 comet_tint(vec3 p)
{
    vec3 colour=vec3(0.0,0.0,0.0);
    float total=0.0;
    for(int k=0;k<4;++k)
    {
        vec4 head=u_comets[3*k];
        if(head.w>0.0)
        {
            vec3 tail=u_comets[3*k+1].xyz;
            vec3 axis=head.xyz-tail;
            float t=clamp(dot(p-tail,axis)/max(dot(axis,axis),1.0),0.0,1.0);
            float d=length(p-(tail+axis*t));
            float w=head.w*(1.0-smoothstep(0.0,max(u_comets[12].x,1.0),d))*t*t*(3.0-2.0*t);
            colour+=u_comets[3*k+2].xyz*w;
            total+=w;
        }
    }
    return vec4(total>0.0?colour/total:colour,min(total,1.0)*u_comets[12].y);
}
// LOD com a distância ([10]: início e fim em cm, fração mínima, px mínimos): ao longe, cada estrutura conserva só uma
// fração dos pontos (sempre os mesmos, por um valor fixo de cada ponto), cerca de (início/distância)², para a densidade
// no ecrã ficar estável; os que ficam crescem na mesma proporção. Devolve a fração conservada (1 perto).
float lod_keep(vec4 world)
{
    float d=length(((u_view)*(world)).xyz);
    float start=max(u_dots[10].x,1.0);
    if(d<=start) return 1.0;
    if(d>=u_dots[10].y) return u_dots[10].z;
    float k=start/d;
    return max(k*k,u_dots[10].z);
}
float dot_hash(vec3 p,float seed)
{
    return fract(sin(dot(p,vec3(27.619,57.583,11.973))+seed*17.31)*43758.5453);
}
// Desvanecimento com a distância a quem vê: [8].y início e [8].z fim (cm), [8].w brilho que resta.
// Estável: depende só da posição, sem cintilação no tempo.
float distance_fade(vec4 world)
{
    float d=length(((u_view)*(world)).xyz);
    return mix(u_dots[8].w,1.0,1.0-smoothstep(u_dots[8].y,max(u_dots[8].z,u_dots[8].y+1.0),d));
}
// Queda antes do túnel (u_layout.z: progresso da saída): cada ponto desce até ao chão com um atraso
// próprio e depois encolhe até desaparecer. Devolve a escala do ponto.
float dot_fall(inout vec4 world)
{
    if(u_dots[7].z<0.5 || u_layout.z<=0.0) return 1.0;
    float spread=u_dots[7].w;
    float delay=fract(sin(dot(world.xyz,vec3(0.1291,0.0783,0.0373)))*43758.5453);
    float q=clamp((u_layout.z-delay*spread)/max(1.0-spread,0.05),0.0,1.0);
    float drop=clamp(q/0.8,0.0,1.0);
    world.y=mix(world.y,min(world.y,2.0),drop*drop);
    return 1.0-smoothstep(0.8,1.0,q);
}
// Força com que a mão aponta para o centro desta instância (0 fora do cone de ~10°).
float pointing(vec3 center,vec4 origin,vec4 direction)
{
    if(origin.w<=0.0) return 0.0;
    vec3 offset=center-origin.xyz;
    float cosine=dot(offset,direction.xyz)/max(length(offset),0.0001);
    return origin.w*smoothstep(direction.w,mix(direction.w,1.0,0.6),cosine);
}
// Anéis: conta o ponto da borda na direção apontada, não o centro no eixo do túnel.
float pointing_ring(vec3 center,float radius,vec4 origin,vec4 direction)
{
    vec2 across=direction.xy;
    vec3 target=center;
    if(length(across)>0.02) target.xy+=normalize(across)*radius;
    return pointing(target,origin,direction);
}
// Força deixada pelas direções apontadas há pouco (seis amostras por mão a partir de first); o
// objeto é testado onde estava nesse momento (w da direção = deslocamento da câmara desde então).
float trail(vec3 center,bool ring,float radius,int first)
{
    float best=0.0;
    for(int k=0;k<6;++k)
    {
        vec4 origin=u_trail[2*(first+k)];
        vec4 direction=vec4(u_trail[2*(first+k)+1].xyz,u_trail[24].x);
        vec3 then=center+vec3(0.0,0.0,u_trail[2*(first+k)+1].w);
        best=max(best,ring?pointing_ring(then,radius,origin,direction):pointing(then,origin,direction));
    }
    return best;
}
// Afastamento lateral em relação à linha apontada: abre caminho em vez de empurrar para longe.
vec3 parting(vec3 center,vec4 origin,vec4 direction,float strength)
{
    vec3 offset=center-origin.xyz;
    vec3 radial=offset-dot(offset,direction.xyz)*direction.xyz;
    return radial/max(length(radial),1.0)*strength;
}
void main()
{
    vec3 local=a_position;
    // Cometas: uma linha reta de pontos (a cabeça e o rasto são recortados no fragment shader).
    if(u_dots[9].x>0.5 && u_style.z>0.5 && i_data4.z>8.5 && i_data4.z<9.5) { local.x=0.0; local.z=0.0; }
    float dot_code=length(a_normal);
    vec3 source_normal=a_normal/max(dot_code,0.0001);
    vec3 normal=source_normal;
    // Mãos só na experiência dirigida; o campo antigo fica como estava.
    vec3 center=i_data3.xyz;
    float kind=i_data4.z;
    bool ring=kind>4.5 && kind<5.5;
    float ring_radius=length(i_data0.xyz)*0.82;
    float left=u_style.z<0.5?0.0:ring?pointing_ring(center,ring_radius,u_point[0],u_point[1]):pointing(center,u_point[0],u_point[1]);
    float right=u_style.z<0.5?0.0:ring?pointing_ring(center,ring_radius,u_point[2],u_point[3]):pointing(center,u_point[2],u_point[3]);
    if(u_style.z>0.5) { left=max(left,trail(center,ring,ring_radius,0)); right=max(right,trail(center,ring,ring_radius,6)); }
    // Família da resposta: 4 cones, 5 cristais, 6 anéis, 7 restantes; o chão não responde.
    int family=kind>8.5 && kind<9.5?4:kind>7.5 && kind<8.5?5:ring?6:7;
    vec4 amount=u_respond[family*2];      // luz, levitar (cm), crescer, esticar
    vec4 shape=u_respond[family*2+1];     // rodar (rad), abrir caminho (cm), alargar, eco
    // Variação por objeto: amplitude 0,7–1,3 e sentido de rotação a partir da semente.
    float seed=fract(sin(i_data4.y*78.233+u_respond[16].y)*43758.5453);
    float vary=abs(kind-2.0)>0.1?1.0+u_respond[16].x*(seed-0.5)*0.6:0.0;
    left*=vary; right*=vary;
    float revealed=max(left,right);
    float echo=u_style.z>0.5?u_point[4].x*shape.w:0.0;
    vec3 shift=vec3(0.0,0.0,0.0);
    if(abs(kind-2.0)>0.1)
    {
        if(local.y>0.0) local.y*=1.0+amount.w*revealed;                                  // esticar para cima
        local*=1.0+amount.z*revealed+u_respond[16].z*echo;                               // crescer; eco salta
        if(!ring) local.xz*=1.0+shape.z*revealed;                                        // alargar
        float angle=shape.x*revealed*(u_respond[16].x>0.5 && seed<0.5?-1.0:1.0);        // rodar
        if(angle!=0.0)
        {
            float c=cos(angle),s=sin(angle);
            local.xz=vec2(c*local.x+s*local.z,-s*local.x+c*local.z);
            normal.xz=vec2(c*normal.x+s*normal.z,-s*normal.x+c*normal.z);
        }
        shift.y=amount.y*revealed+u_respond[16].w*echo;                                  // levitar; eco salta
        if(kind<12.5)                                                                     // abrir caminho
            shift+=parting(center,u_point[0],u_point[1],shape.y*left)+parting(center,u_point[2],u_point[3],shape.y*right);
    }
    float ground=1.0-step(0.1,abs(i_data4.z-2.0));
    float tunnel=step(2.5,i_data4.z)*(1.0-step(7.5,i_data4.z));
    float pyramid=1.0-step(0.55,i_data4.z)+1.0-step(0.1,abs(i_data4.z-10.0));
    // Modelação estática das pirâmides; nenhuma dimensão depende da animação ou opacidade.
    if(ground<0.5 && pyramid>0.5 && local.y>0.0) local.xz=vec2(0.0,0.0);
    if(u_style.z>0.5 && abs(i_data4.z-5.0)<0.1)
    {
        float radius=max(length(local.xy),0.0001);
        local.xy*=(0.82+(radius-0.82)*0.2)/radius;
        local.z*=0.2;
        local.xy*=1.0+shape.z*revealed;   // anéis apontados alargam
    }
    if(u_style.z>0.5 && i_data4.z>8.5 && i_data4.z<9.5)
    {
        float c=cos(i_data0.w),s=sin(i_data0.w);
        local.xz=vec2(c*local.x+s*local.z,-s*local.x+c*local.z);
        normal.xz=vec2(c*normal.x+s*normal.z,-s*normal.x+c*normal.z);
    }
    // Os componentes w transportam ângulo/opacidade, separados da transformação afim.
    mat4 model=mat4(vec4(i_data0.xyz,0.0),vec4(i_data1.xyz,0.0),vec4(i_data2.xyz,0.0),vec4(i_data3.xyz,1.0));
    vec4 world=((model)*(vec4(local,1.0)));
    if(ground<0.5 && u_style.z<0.5) world.z+=mod(i_data3.z-u_clock.y+u_clock.z+tunnel*1600.0,u_clock.z)-tunnel*1600.0-i_data3.z;
    if(ground<0.5) world.xyz+=shift;
    // if, não ?: (o HLSL avalia os dois ramos e dot_fall altera world).
    float size=1.0;
    if(ground<0.5 && tunnel<0.5) size=dot_fall(world);
    // Os cometas não se tingem a si próprios; o chão e o túnel também não.
    bool comet=kind>8.5 && kind<9.5;
    v_tint=ground<0.5 && tunnel<0.5 && !comet?comet_tint(world.xyz):vec4(0.0,0.0,0.0,0.0);
    // Cometas: os pontos afinam do rasto para a cabeça (mesma posição no rasto que o fragment shader).
    if(comet && u_dots[9].x>0.5 && u_style.z>0.5)
    {
        float tail=max(i_data2.w-u_dots[8].x,0.0);
        size*=mix(0.35,1.0,clamp((a_position.y*0.5-tail)/max(i_data2.w-tail,0.0001),0.0,1.0));
    }
    if(u_clock.w>0.5) world.y=-world.y;
    v_world=world.xyz;
    v_local=a_position;
    v_normal=normalize(i_data0.xyz*normal.x/max(dot(i_data0.xyz,i_data0.xyz),0.000001)
        +i_data1.xyz*normal.y/max(dot(i_data1.xyz,i_data1.xyz),0.000001)
        +i_data2.xyz*normal.z/max(dot(i_data2.xyz,i_data2.xyz),0.000001));
    if(u_clock.w>0.5) v_normal.y=-v_normal.y;
    v_pattern=abs(source_normal.y)>0.5?a_position.xz*0.5+0.5:abs(source_normal.z)>0.5?a_position.xy*0.5+0.5:a_position.zy*0.5+0.5;
    if(i_data4.z>3.5) v_pattern=a_texcoord0;
    if(u_style.z>0.5 && i_data4.z>8.5 && i_data4.z<9.5) v_pattern.x=i_data2.w;
    v_meta=i_data4; v_meta.w=i_data1.w;
    v_response=ground<0.5?vec2(amount.x*revealed,echo):vec2(0.0,0.0);
    gl_Position=((u_viewProj)*(world));
    // Diâmetro mínimo no ecrã para os anéis e para as linhas que substituem os cones (poucas peças, custo baixo).
    bool cone_line=u_dots[9].x>0.5 && kind>8.5 && kind<9.5;
    // Estruturas longínquas da extensão: perdem brilho com a distância; o túnel, os anéis, o chão, os cones e os cometas não.
    float fade=dot_code>1.5 && ground<0.5 && tunnel<0.5 && !(kind>8.5 && kind<9.5)?distance_fade(world):1.0;
    // Túnel final a dissolver-se quando a música termina ([9].y progresso, [9].z desencontro): cada ponto tem o seu
    // momento (estável, a partir da posição na malha e da instância) e apaga-se e encolhe até desaparecer.
    if(tunnel>0.5 && u_style.z>0.5 && u_dots[9].y>0.0)
    {
        float h=fract(sin(dot(a_position,vec3(12.9898,78.233,37.719))+i_data4.y*91.7)*43758.5453);
        float start=h*u_dots[9].z;
        fade*=1.0-smoothstep(start,start+(1.0-u_dots[9].z),u_dots[9].y);
        size*=0.5+0.5*fade;
    }
    // LOD: estruturas da extensão ao longe com menos pontos, maiores (o túnel, os anéis, o chão e os cometas não).
    float keep=dot_code>1.5 && ground<0.5 && tunnel<0.5 && !(kind>8.5 && kind<9.5) && u_style.z>0.5?lod_keep(world):1.0;
    bool dropped=keep<1.0 && dot_hash(a_position,i_data4.y)>keep;
    size*=min(inversesqrt(keep),4.0);
    float min_px=u_style.z>0.5?max(ring || cone_line?1.5:0.0,u_dots[10].w):0.0;
    float gain=1.0;
    v_dot=vec4(expand_dot(dot_code,dot_shape(i_data4.z+8.0),min_px,size,gl_Position,gain),fade);
    // Anéis e cometas mantêm o brilho (o mínimo de píxeis serve para não desaparecerem ao longe).
    if(ring || cone_line) gain=1.0;
    v_dot.w*=gain;
    if((ground<0.5 && i_data1.w<=0.0)||fade<=0.001||dropped) gl_Position=vec4(2.0,2.0,2.0,1.0);
    v_clip=gl_Position;
}`;
export const vs_opening = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec3 a_position;
in vec3 a_normal;
in vec2 a_texcoord0;
in vec4 i_data0;
in vec4 i_data1;
in vec4 i_data2;
in vec4 i_data3;
in vec4 i_data4;
out vec3 v_world;
out vec3 v_local;
out vec3 v_normal;
out vec4 v_meta;
out vec4 v_clip;
out vec2 v_pattern;
out vec2 v_response;
out vec4 v_dot;
out vec4 v_tint;
uniform vec4 u_scene;
uniform vec4 u_clock;
uniform vec4 u_style;
uniform vec4 u_layout;
uniform vec4 u_art;
uniform vec4 u_point[5];
// Botões da resposta (src/interaction/response_profile.*): amplitudes por família e eco.
uniform vec4 u_respond[17];
// Memória do toque (src/interaction/point_trail.*): direções apontadas recentes de cada mão.
uniform vec4 u_trail[25];
// Versão de pontos (src/render/dot_geometry.*): [0] raio Opening (cm), brilho mínimo Opening, suavidade,
// brilho mínimo extensão; [1..2] forma por família Opening ([2].w: raio da extensão, cm); [3..6] forma por tipo
// da extensão (0 redondo, 1 quadrado); [7] pirâmides (brilho mínimo, px mínimos), queda antes do túnel (ligada,
// desencontro); [8] cometas (rasto) e desvanecimento com a distância; [9].x linhas no lugar dos cones, [9].w brilho
// dos círculos ao ritmo (instâncias
// marcadas com i_data0.w=1 pela CPU).
uniform vec4 u_dots[11];
float dot_shape(float index)
{
    int i=int(clamp(index,0.0,23.0)+0.5);
    vec4 v=u_dots[1+i/4];
    int c=i-4*(i/4);
    return c==0?v.x:c==1?v.y:c==2?v.z:v.w;
}
// Cada ponto chega como quatro vértices na mesma posição; a normal com comprimento 2–5 indica o
// canto, que se afasta no plano da imagem: o ponto tem sempre o mesmo tamanho e fica virado para quem vê.
vec3 expand_dot(float code,float shape,float min_pixels,float size,inout vec4 position,inout float gain)
{
    if(code<1.5) return vec3(0.0,0.0,-1.0);
    float corner=floor(code+0.5)-2.0;
    vec2 offset=vec2(corner>0.5 && corner<2.5?1.0:-1.0,corner>1.5?1.0:-1.0);
    // min_pixels: diâmetro mínimo no ecrã (só onde é pedido, p. ex. pirâmides; alargar tudo custa demasiado).
    vec2 world_size=u_dots[0].x*vec2(u_proj[0][0],u_proj[1][1]);
    vec2 pixel_size=vec2(min_pixels/max(u_viewRect.z,1.0),min_pixels/max(u_viewRect.w,1.0))*position.w;
    // O tamanho mínimo no ecrã não se multiplica pelo LOD; um ponto alargado só pelo mínimo perde brilho na proporção
    // da área ganha, para a luz total não aumentar (bordo suave no fragment shader).
    vec2 grown=max(world_size*size,pixel_size);
    position.xy+=offset*grown;
    vec2 ratio=world_size*size/max(grown,vec2(1e-6,1e-6));
    gain=clamp(ratio.x*ratio.y,0.15,1.0);
    return vec3(offset,shape);
}
// Cometas a passar (src/render/renderer.cpp, update_comets): até 4 cápsulas [3k] cabeça e força, [3k+1] onde a cabeça
// estava há comet_tint_decay_seconds, [3k+2] cor; [12] raio (cm) e intensidade máxima. As estruturas tomam a cor do
// cometa aos poucos: perto da cabeça a cor sobe depressa e, ao longo do rasto, desaparece suavemente.
uniform vec4 u_comets[13];
vec4 comet_tint(vec3 p)
{
    vec3 colour=vec3(0.0,0.0,0.0);
    float total=0.0;
    for(int k=0;k<4;++k)
    {
        vec4 head=u_comets[3*k];
        if(head.w>0.0)
        {
            vec3 tail=u_comets[3*k+1].xyz;
            vec3 axis=head.xyz-tail;
            float t=clamp(dot(p-tail,axis)/max(dot(axis,axis),1.0),0.0,1.0);
            float d=length(p-(tail+axis*t));
            float w=head.w*(1.0-smoothstep(0.0,max(u_comets[12].x,1.0),d))*t*t*(3.0-2.0*t);
            colour+=u_comets[3*k+2].xyz*w;
            total+=w;
        }
    }
    return vec4(total>0.0?colour/total:colour,min(total,1.0)*u_comets[12].y);
}
// LOD com a distância ([10]: início e fim em cm, fração mínima, px mínimos): ao longe, cada estrutura conserva só uma
// fração dos pontos (sempre os mesmos, por um valor fixo de cada ponto), cerca de (início/distância)², para a densidade
// no ecrã ficar estável; os que ficam crescem na mesma proporção. Devolve a fração conservada (1 perto).
float lod_keep(vec4 world)
{
    float d=length(((u_view)*(world)).xyz);
    float start=max(u_dots[10].x,1.0);
    if(d<=start) return 1.0;
    if(d>=u_dots[10].y) return u_dots[10].z;
    float k=start/d;
    return max(k*k,u_dots[10].z);
}
float dot_hash(vec3 p,float seed)
{
    return fract(sin(dot(p,vec3(27.619,57.583,11.973))+seed*17.31)*43758.5453);
}
// Desvanecimento com a distância a quem vê: [8].y início e [8].z fim (cm), [8].w brilho que resta.
// Estável: depende só da posição, sem cintilação no tempo.
float distance_fade(vec4 world)
{
    float d=length(((u_view)*(world)).xyz);
    return mix(u_dots[8].w,1.0,1.0-smoothstep(u_dots[8].y,max(u_dots[8].z,u_dots[8].y+1.0),d));
}
// Queda antes do túnel (u_layout.z: progresso da saída): cada ponto desce até ao chão com um atraso
// próprio e depois encolhe até desaparecer. Devolve a escala do ponto.
float dot_fall(inout vec4 world)
{
    if(u_dots[7].z<0.5 || u_layout.z<=0.0) return 1.0;
    float spread=u_dots[7].w;
    float delay=fract(sin(dot(world.xyz,vec3(0.1291,0.0783,0.0373)))*43758.5453);
    float q=clamp((u_layout.z-delay*spread)/max(1.0-spread,0.05),0.0,1.0);
    float drop=clamp(q/0.8,0.0,1.0);
    world.y=mix(world.y,min(world.y,2.0),drop*drop);
    return 1.0-smoothstep(0.8,1.0,q);
}
// Força com que a mão aponta para o centro desta instância (0 fora do cone de ~10°).
float pointing(vec3 center,vec4 origin,vec4 direction)
{
    if(origin.w<=0.0) return 0.0;
    vec3 offset=center-origin.xyz;
    float cosine=dot(offset,direction.xyz)/max(length(offset),0.0001);
    return origin.w*smoothstep(direction.w,mix(direction.w,1.0,0.6),cosine);
}
// Força deixada pelas direções apontadas há pouco (primeira amostra first, seis por mão); o
// objeto é testado onde estava nesse momento (w da direção = deslocamento da câmara desde então).
float trail(vec3 center,int first)
{
    float best=0.0;
    for(int k=0;k<6;++k)
    {
        vec4 direction=u_trail[2*(first+k)+1];
        best=max(best,pointing(center+vec3(0.0,0.0,direction.w),u_trail[2*(first+k)],vec4(direction.xyz,u_trail[24].x)));
    }
    return best;
}
void main()
{
    mat4 model=mat4(vec4(i_data0.xyz,0.0),vec4(i_data1.xyz,0.0),vec4(i_data2.xyz,0.0),vec4(i_data3.xyz,1.0));
    vec3 center=i_data3.xyz;
    center.z-=u_clock.y;
    float revealed=max(pointing(center,u_point[0],u_point[1]),pointing(center,u_point[2],u_point[3]));
    revealed=max(revealed,max(trail(center,0),trail(center,6)));
    float role=u_art.w;
    // Família da resposta: 0 pedras, 1 pontos, 2 tracejados/pilares, 3 hexágonos e formas escuras.
    int family=role>2.5 && role<3.5?0:role>4.5 && role<5.5?1:(role>1.5 && role<2.5)||role>5.5?2:3;
    vec4 amount=u_respond[family*2];      // luz, levitar (cm), crescer, esticar
    vec4 shape=u_respond[family*2+1];     // rodar (rad), abrir caminho, alargar, eco
    // Variação por objeto: amplitude 0,7–1,3 e sentido de rotação a partir da semente.
    float seed=fract(sin(i_data4.y*78.233+u_respond[16].y)*43758.5453);
    float response=revealed*(1.0+u_respond[16].x*(seed-0.5)*0.6);
    float echo=u_point[4].x*shape.w;
    vec3 local=a_position;
    float dot_code=length(a_normal);
    vec3 normal=a_normal/max(dot_code,0.0001);
    // Resposta às mãos; sem mãos (response=echo=0) a malha fica intacta.
    local*=1.0+amount.z*response+u_respond[16].z*echo;                            // crescer; eco salta
    if(local.y>0.0) local.y*=1.0+amount.w*response;                                // esticar para cima
    local.xz*=1.0+shape.z*response;                                                // alargar
    float angle=shape.x*response*(u_respond[16].x>0.5 && seed<0.5?-1.0:1.0);      // rodar para a pessoa
    // As formas da família 3 sempre passaram por esta rotação (ângulo 0 sem mãos); manter igual.
    if(angle!=0.0 || family==3)
    {
        float c=cos(angle),s=sin(angle);
        local.xz=vec2(c*local.x+s*local.z,-s*local.x+c*local.z);
        normal.xz=vec2(c*normal.x+s*normal.z,-s*normal.x+c*normal.z);
    }
    // Cauda subterrânea fixa: o poste desloca-se inteiro, sem alongar a haste.
    if(i_data4.x>0.0 && i_data4.z>10.5 && i_data4.z<11.5)
        if(local.y<=0.001) local.y=-1000.0/max(length(i_data1.xyz),0.0001);
    vec4 world=((model)*(vec4(local,1.0)));
    world.z-=u_clock.y;
    // Levitar, com uma oscilação lenta própria de cada objeto; o eco dá um pequeno salto.
    world.y+=amount.y*response*(1.0+0.18*sin(u_art.z*1.7+i_data4.y*6.2831853))+u_respond[16].w*echo;
    float size=1.0;
    size*=dot_fall(world);
    v_tint=comet_tint(world.xyz);
    if(u_clock.w>0.5) world.y=-world.y;
    v_world=world.xyz;
    v_local=a_position;
    v_pattern=a_texcoord0;
    v_normal=normalize(i_data0.xyz*normal.x/max(dot(i_data0.xyz,i_data0.xyz),0.000001)
        +i_data1.xyz*normal.y/max(dot(i_data1.xyz,i_data1.xyz),0.000001)
        +i_data2.xyz*normal.z/max(dot(i_data2.xyz,i_data2.xyz),0.000001));
    if(u_clock.w>0.5) v_normal.y=-v_normal.y;
    v_meta=i_data4;
    // Opacidade preparada na CPU: a classificação opaco/transparente usa exatamente o mesmo valor.
    float presence=i_data1.w;
    v_meta.x=presence;
    v_response=vec2(amount.x*response,echo);
    gl_Position=((u_viewProj)*(world));
    // Estruturas longínquas: perdem brilho com a distância (os círculos ao ritmo não).
    float fade=dot_code>1.5 && i_data0.w<0.5?distance_fade(world):1.0;
    // LOD: ao longe ficam menos pontos, maiores; nenhum abaixo de u_dots[10].w píxeis.
    // Só na peça dirigida (u_style.z); o campo antigo fica como estava.
    float keep=dot_code>1.5 && i_data0.w<0.5 && u_style.z>0.5?lod_keep(world):1.0;
    bool dropped=keep<1.0 && dot_hash(a_position,i_data4.y)>keep;
    size*=min(inversesqrt(keep),4.0);
    float min_px=max(role>3.5 && role<4.5?u_dots[7].y:0.0,u_style.z>0.5?u_dots[10].w:0.0);
    float gain=1.0;
    v_dot=vec4(expand_dot(dot_code,dot_shape(role),min_px,size,gl_Position,gain),fade);
    v_dot.w*=gain;
    // Círculos ao ritmo (i_data0.w=1): v_dot.z soma 2 à forma; o fragment shader acende-os sem esperar pelos graves.
    if(dot_code>1.5 && i_data0.w>0.5) v_dot.z+=2.0;
    if(u_scene.w<=0.0||i_data4.w>=clamp(u_scene.w*2.0,0.0,1.0)||u_style.x<=0.0||presence<=0.0||fade<=0.001||dropped)
        gl_Position=vec4(2.0,2.0,2.0,1.0);
    v_clip=gl_Position;
}`;
export const fs_scene = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec3 v_world;
in vec3 v_local;
in vec3 v_normal;
in vec4 v_meta;
in vec4 v_clip;
in vec2 v_pattern;
in vec2 v_response;
in vec4 v_dot;
in vec4 v_tint;
out vec4 fragColor;
uniform vec4 u_scene;
uniform vec4 u_clock;
uniform vec4 u_color0;
uniform vec4 u_color1;
uniform vec4 u_eye;
uniform vec4 u_style;
uniform vec4 u_atmosphere;
uniform vec4 u_art;
uniform vec4 u_choreography[7];
uniform vec4 u_spectral[11];
uniform vec4 u_dots[11];
// Recorte do ponto: redondo ou quadrado, com o bordo suavizado; devolve a luz do ponto (1 fora dos pontos).
float dot_light(vec3 dot_data)
{
    if(dot_data.z<-0.5) return 1.0;
    float r=dot_data.z<0.5?length(dot_data.xy):max(abs(dot_data.x),abs(dot_data.y));
    if(r>1.0) discard;
    // Núcleo mais intenso: o ponto ocupa pouca área e deve continuar a alimentar o bloom.
    return mix(1.6,0.15,smoothstep(1.0-u_dots[0].z,1.0,r));
}
// lit=1 nos pontos: cada ponto é um LED aceso (o UV é constante no ponto e não amostra a grelha).
float ledDots(vec2 uv,vec2 grid,float radius,float lit)
{
    vec2 cells=uv*grid;
    vec2 pixel=abs(fract(cells)-0.5);
    float footprint=max(fwidth(cells.x),fwidth(cells.y));
    float pointMask=1.0-smoothstep(radius,radius+max(footprint*0.6,0.035),max(pixel.x,pixel.y));
    return max(mix(pointMask,radius*radius*4.0,smoothstep(0.6,1.5,footprint)),lit);
}
void main()
{
    float light=dot_light(v_dot.xyz);
    float lit=step(-0.5,v_dot.z);
    float phase=v_meta.y*6.2831853;
    float beat=mix(pow(max(0.0,sin(u_clock.x*12.5663706-phase*0.25)),6.0),u_art.x,step(0.5,u_style.z));
    float tunnel=step(2.5,v_meta.z)*(1.0-step(7.5,v_meta.z));
    float depth=smoothstep(1800.0,8000.0,v_world.z);
    vec3 color=mix(u_color0.xyz,u_color1.xyz,clamp(depth+step(0.85,v_meta.x)*0.3,0.0,1.0));
    vec2 uv=v_pattern;
    float mask=0.0;
    // Cometas: opacidade de cada ponto (1 fora dos cometas).
    float comet_alpha=1.0;
    if(tunnel>0.5)
    {
        float travel=uv.x*7.0+uv.y*3.0-u_clock.x*0.3+v_meta.y*4.0;
        float bands=1.0-smoothstep(0.035,0.075,abs(fract(uv.y*5.0+u_clock.x*0.08)-0.5));
        float wave=0.5+0.5*sin(travel*6.2831853);
        float islands=smoothstep(0.53,0.68,wave);
        float dots=ledDots(uv,vec2(48.0,24.0),0.26,lit);
        if(v_meta.z<3.5)
        {
            vec3 inward=normalize(vec3(-v_world.x,260.0-v_world.y,0.0));
            float front=step(0.5,dot(normalize(v_normal),inward));
            float frame=smoothstep(0.06,0.13,min(min(uv.x,1.0-uv.x),min(uv.y,1.0-uv.y)));
            float scribble=1.0-smoothstep(0.025,0.065,abs(uv.y-0.5-0.35*sin(uv.x*13.0+u_clock.x*0.4+phase)));
            float diagonal=1.0-smoothstep(0.025,0.065,abs(fract(uv.x*3.0+uv.y*2.0+u_clock.x*0.12)-0.5));
            float pattern=v_meta.x<0.33?bands:v_meta.x<0.66?max(scribble,diagonal):islands;
            mask=pattern*ledDots(uv,vec2(128.0,96.0),0.35,lit)*front*frame;
        }
        else if(v_meta.z<4.5) mask=dots*step(0.30,fract(uv.x*6.0+v_meta.y))*step(0.25,fract(uv.y*4.0));
        else if(v_meta.z<5.5)
        {
            mask=u_style.z>0.5 ? 0.35+dots*0.4 : (0.04+dots*0.4)*step(0.35,v_meta.x);
            if(u_style.z>0.5 && u_choreography[6].z>0.5)
            {
                float group=mod(floor(v_meta.y*63.0+0.5),2.0);
                float active_=1.0-step(0.5,abs(group-u_choreography[6].x));
                float pulse=u_choreography[6].y*active_;
                color=group<0.5?u_spectral[5].xyz:u_spectral[6].xyz;
                mask*=u_spectral[6].w+u_spectral[5].w*pulse;
                // O grupo inativo conserva apenas a luz residual; não recebe o pulso global.
                beat=0.0;
            }
        }
        else if(v_meta.z<6.5) mask=ledDots(uv,vec2(72.0,9.0),0.25,lit)*islands*step(0.5,v_meta.x);
        else mask=0.5;
        mask*=0.55+0.45*pow(0.5+0.5*sin(u_clock.x*0.8+phase),2.0);
    }
    else if(v_meta.z>7.5)
    {
        color=mix(u_color0.xyz,u_color1.xyz,v_meta.x*0.5);
        float family=v_meta.z;
        float ledDensity=u_style.z>0.5?max(0.02,u_choreography[3].z):1.0;
        if(family<8.5)
        {
            vec2 boundary=min(uv,1.0-uv);
            float width=u_spectral[4].w;
            float edge=1.0-smoothstep(width,width+max(fwidth(uv.x),fwidth(uv.y)),min(boundary.x,boundary.y));
            float facet=0.5+0.5*dot(normalize(v_normal),normalize(vec3(0.3,0.7,-0.5)));
            color=mix(u_spectral[2].xyz,u_spectral[3].xyz,fract(v_meta.x*2.7+v_normal.y*0.37));
            mask=edge*u_spectral[4].y+u_spectral[4].z*facet;
        }
        else if(family<9.5)
        {
            // Só as nervuras são desenhadas progressivamente em altura; os anéis são peças próprias.
            if(u_style.z>0.5 && v_local.y>v_pattern.x*2.0) discard;
            vec3 first=u_spectral[0].xyz,second=u_spectral[1].xyz;
            float variant=floor(clamp(v_meta.x,0.0,0.9999)*u_choreography[6].w);
            if(variant>0.5 && variant<1.5) { first=u_spectral[7].xyz; second=u_spectral[8].xyz; }
            else if(variant>1.5) { first=u_spectral[9].xyz; second=u_spectral[10].xyz; }
            color=mix(first,second,0.5+0.5*sin(uv.y*28.27433+v_meta.x*2.0));
            mask=u_spectral[4].x;
            // Cometas: só o troço entre a cauda e a cabeça. Sempre nas cores da fase (u_color0/1 preparadas pela CPU
            // para os cometas), nunca brancos. Cada ponto é mais transparente do que o anterior, em linha reta ao longo
            // de todo o rasto: opaco na cabeça e totalmente transparente no último ponto (comet_dot_alpha, CPU).
            if(u_dots[9].x>0.5 && u_style.z>0.5)
            {
                float trail=max(u_dots[8].x,0.001);
                float position=v_local.y*0.5;
                float tail=max(v_pattern.x-trail,0.0);
                float along=(position-tail)/max(v_pattern.x-tail,0.0001);
                if(along<0.0) discard;
                float a=clamp(along,0.0,1.0);
                color=mix(u_color0.xyz,u_color1.xyz,step(0.5,v_meta.x));
                float far=clamp((position-0.85)/0.15,0.0,1.0);
                comet_alpha=a*(1.0-far*far*(3.0-2.0*far));
                if(comet_alpha<=0.0) discard;
                mask=0.9+0.6*smoothstep(0.9,1.0,a);
            }
        }
        else if(family<10.5) mask=0.012;
        else if(family<11.5) mask=step(0.88,v_local.y)*0.75+0.008;
        else if(family<12.5) mask=0.025+step(0.82,abs(v_local.y))*0.65;
        else mask=(1.0-smoothstep(0.018,0.045,abs(uv.y-0.90)))*step(0.5,v_normal.y*(1.0-2.0*u_clock.w));
    }
    else
    {
        color=mix(u_color0.xyz,u_color1.xyz,v_meta.x*0.55);
        vec2 face=abs(v_normal.z)>0.5?v_local.xy:v_local.zy;
        float contour=face.y+2.0*abs(face.x);
        float chevron=abs(fract(contour*3.0+u_clock.x*0.025+v_meta.y*0.1)-0.5);
        float lines=1.0-smoothstep(0.035,0.035+max(fwidth(contour)*3.0,0.006),chevron);
        float outer=1.0-smoothstep(0.018,0.018+fwidth(contour),abs(contour-1.0));
        float stripes=1.0-smoothstep(0.04,0.095,abs(fract((face.y+1.0)*5.5)-0.5));
        mask=(v_meta.z<0.55?max(lines,outer):stripes)*ledDots(uv,vec2(120.0,160.0),0.43,lit);
        mask*=0.10+0.90*pow(0.5+0.5*sin(u_clock.x*0.65+phase),3.0);
    }
    if(v_dot.z>-0.5) mask=max(mask,u_dots[0].w);
    // Cometas a passar: a cor da estrutura aproxima-se gradualmente da do cometa.
    color=mix(color,v_tint.xyz,clamp(v_tint.w,0.0,1.0));
    vec3 normal=normalize(v_normal);
    vec3 viewDirection=normalize(u_eye.xyz-v_world);
    if(dot(normal,viewDirection)<0.0) normal=-normal;
    vec3 lightDirection=normalize(vec3(-0.4,0.45,-0.8));
    float diffuse=max(0.0,dot(normal,lightDirection));
    float highlight=pow(max(0.0,dot(reflect(-lightDirection,normal),viewDirection)),48.0);
    float rim=pow(1.0-max(0.0,dot(normal,viewDirection)),3.0);
    vec3 body=mix(vec3(0.009,0.012,0.02),color*0.026,0.65);
    body*=0.45+diffuse*2.0;
    vec3 reflected=reflect(-viewDirection,normal);
    vec3 reflectedColor=mix(u_color0.xyz,u_color1.xyz,pow(max(0.0,reflected.z),3.0));
    body+=reflectedColor*(highlight*0.2+rim*0.016);
    // Mãos: o objeto apontado intensifica o seu padrão; o eco dá-lhe um brilho dourado.
    float revealed=v_response.x,echo=v_response.y;
    vec3 rgb=body*u_scene.x*0.16+color*mask*u_scene.x*(2.8+beat*u_scene.y*3.0)*(1.0+1.2*revealed);
    rgb+=(color*0.03*revealed+vec3(1.0,0.7,0.25)*0.035*echo)*u_scene.x*(0.3+mask);
    rgb*=light;
    float distanceToEye=length(v_world-u_eye.xyz);
    float fogMultiplier=u_style.z>0.5?max(0.0,u_choreography[3].y):1.0;
    float fog=exp(-distanceToEye*(0.000008+u_scene.z*0.000065)*fogMultiplier);
    vec3 haze=(mix(u_color0.xyz,u_color1.xyz,depth)*0.015+u_atmosphere.xyz*0.12)*u_scene.x;
    rgb=mix(haze,rgb,fog);
    // Opacidade real: as peças mantêm a dimensão final durante entradas e saídas.
    fragColor=vec4(rgb*v_dot.w,clamp(v_meta.w*comet_alpha,0.0,1.0));
}`;
export const fs_opening = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec3 v_world;
in vec3 v_local;
in vec3 v_normal;
in vec4 v_meta;
in vec4 v_clip;
in vec2 v_pattern;
in vec2 v_response;
in vec4 v_dot;
in vec4 v_tint;
uniform sampler2D s_detail;
out vec4 fragColor;
uniform vec4 u_scene;
uniform vec4 u_clock;
uniform vec4 u_style;
uniform vec4 u_color0;
uniform vec4 u_color1;
uniform vec4 u_eye;
uniform vec4 u_atmosphere;
uniform vec4 u_art;
uniform vec4 u_tuning[22];
uniform vec4 u_family;
uniform vec4 u_point[5];
uniform vec4 u_dots[11];
// Recorte do ponto: redondo ou quadrado, com o bordo suavizado; devolve a luz do ponto (1 fora dos pontos).
float dot_light(vec3 dot_data)
{
    if(dot_data.z<-0.5) return 1.0;
    float shape=dot_data.z>1.5?dot_data.z-2.0:dot_data.z;
    float r=shape<0.5?length(dot_data.xy):max(abs(dot_data.x),abs(dot_data.y));
    if(r>1.0) discard;
    // Núcleo mais intenso: o ponto ocupa pouca área e deve continuar a alimentar o bloom.
    return mix(1.6,0.15,smoothstep(1.0-u_dots[0].z,1.0,r));
}
void main()
{
    float kind=v_meta.z;
    if(kind>10.5 && kind<11.5 && v_world.y*(1.0-2.0*u_clock.w)<0.0) discard;
    float light=dot_light(v_dot.xyz);
    float role=u_art.w;
    float pulse=u_art.x*u_scene.y/0.4;
    vec2 uv=v_pattern;
    float emission=0.0;
    // Mãos: apontar revela as formas nessa direção; o eco acende-as todas a dourado.
    float revealed=v_response.x;
    float echo=v_response.y;
    if(role<0.5)
    {
        // Material sem padrão emissivo recuperado: acende linhas, sem clarear o corpo inteiro.
        float contour=uv.y+abs(uv.x-0.5)*2.0;
        float lines=abs(fract(contour*u_tuning[5].w)-0.5);
        float mask=1.0-smoothstep(u_tuning[12].w,u_tuning[12].w+max(fwidth(contour)*u_tuning[5].w,0.005),lines);
        emission=mask*u_tuning[4].w*u_tuning[9].w;
    }
    else if(role>2.5 && role<3.5)
    {
        // Formas arredondadas só aparecem durante as batidas graves do MASTER.
        float lit=max(pulse,max(revealed,echo));
        if(lit<u_tuning[4].z && u_tuning[4].x<=0.0 && v_dot.z<1.5) discard;
        emission=u_tuning[4].x+lit*u_tuning[4].y;
    }
    else if(role>4.5 && role<5.5)
    {
        float height=abs(v_world.y);
        float edges=smoothstep(0.0,u_tuning[5].y,height)*(1.0-smoothstep(u_tuning[5].x-u_tuning[5].y,u_tuning[5].x,height));
        emission=edges*u_tuning[5].z;
    }
    else if(role>1.5 && role<2.5)
    {
        // Colunas alternadas sobem/descem a10 cm/s; a geometria mantém-se no lugar.
        float direction=v_meta.w<0.5?1.0:-1.0;
        if(abs(u_tuning[6].z)>0.5) direction=-u_tuning[6].z;
        float height=v_world.y*(1.0-2.0*u_clock.w);
        float coordinate=(height+direction*u_tuning[21].y)/u_tuning[6].x;
        float edge=fract(coordinate);
        float width=max(fwidth(coordinate),u_tuning[7].w);
        float bars=smoothstep(u_tuning[7].y,u_tuning[7].y+width,edge)*(1.0-smoothstep(u_tuning[7].z-width,u_tuning[7].z,edge));
        emission=bars*(u_tuning[6].w+pulse*u_tuning[7].x);
    }
    else if(kind>0.5 && kind<2.5)
    {
        // Máscaras Detail recuperadas; Mapping dinâmico reconstruído.
        float detail=texture(s_detail,uv).r;
        float top=step(u_tuning[8].z,v_normal.y*(1.0-2.0*u_clock.w));
        emission=detail*top*(u_tuning[8].x+pulse*u_tuning[8].y);
    }
    else if(kind<9.5 && kind>8.5)
        emission=step(u_tuning[9].y,v_local.y)*(u_tuning[8].w+pulse*u_tuning[9].x);
    else if(kind>10.5 && kind<11.5)
        emission=step(u_tuning[9].z,v_local.y)*(u_tuning[8].w+pulse*u_tuning[9].x);
    else if(role>3.5 && role<4.5)
    {
        // Padrão branco da primeira fase; as texturas Substance não foram recuperadas.
        float contour=uv.y+abs(uv.x-0.5)*u_tuning[10].w;
        float lines=abs(fract(contour*u_tuning[10].x)-0.5);
        float white=1.0-smoothstep(u_tuning[10].y,u_tuning[10].z+fwidth(contour)*u_tuning[10].x,lines);
        // As linhas acendem gradualmente aos80s, sem subir a malha.
        float order=clamp(floor(contour*u_tuning[10].x)/u_tuning[11].w,0.0,0.95);
        float activation=smoothstep(order,min(1.0,order+u_tuning[11].z),u_art.y);
        emission=white*activation*(u_tuning[11].x+pulse*u_tuning[11].y);
    }
    // Cada ponto conserva um brilho mínimo, para a estrutura se ler mesmo fora dos padrões.
    if(v_dot.z>-0.5) emission=max(emission,role>3.5 && role<4.5?u_dots[7].x:u_dots[0].y);
    // Círculos ao ritmo (marcados pela CPU): acesos mesmo sem graves.
    if(v_dot.z>1.5) emission=max(emission,u_dots[9].w);
    vec3 tint=mix(vec3(1.0,1.0,1.0),mix(u_color0.xyz,u_color1.xyz,
        mix(u_tuning[1].z,u_tuning[1].w,smoothstep(u_tuning[1].x,u_tuning[1].y,abs(v_world.z)))),u_tuning[0].y)*u_family.xyz;
    // Os pontos permitidos no corredor conservam a luz branca na fase quente.
    if(role>4.5 && role<5.5) tint=u_family.xyz;
    // O eco distingue-se das batidas da música pela cor dourada.
    // Restantes famílias: o padrão próprio intensifica-se e o corpo ganha uma luz ténue.
    if(role<2.5||role>3.5) emission=emission*(1.0+2.0*revealed+echo)+0.35*revealed+0.2*echo;
    // O eco distingue-se das batidas da música pela cor dourada.
    if(echo>revealed && (role<2.5||role>3.5||echo>pulse)) tint=mix(tint,vec3(1.0,0.7,0.25),clamp(echo*1.5,0.0,1.0));
    // Cometas a passar: a luz da estrutura aproxima-se gradualmente da cor do cometa.
    tint=mix(tint,v_tint.xyz,clamp(v_tint.w,0.0,1.0));
    float distance=length(v_world-u_eye.xyz);
    float fog=exp(-distance*(u_tuning[0].z+u_scene.z*u_tuning[0].w));
    vec3 base=u_tuning[2].xyz*(u_tuning[2].w+(1.0-u_tuning[2].w)*max(0.0,v_normal.y));
    if(role<0.5) base*=u_family.xyz*u_family.w;
    if(role>2.5 && role<3.5) base=vec3(0.0,0.0,0.0);
    vec3 rgb=(base+emission*tint*u_tuning[0].x*u_family.w)*u_scene.x/0.6*light;
    rgb=mix(u_tuning[3].xyz+u_atmosphere.xyz*u_tuning[3].w,rgb,fog);
    fragColor=vec4(rgb*v_dot.w,clamp(u_style.x*v_meta.x,0.0,1.0));
}`;
export const fs_ground = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec3 v_world;
in vec3 v_local;
in vec3 v_normal;
in vec4 v_meta;
in vec4 v_clip;
in vec2 v_pattern;
in vec2 v_response;
in vec4 v_dot;
in vec4 v_tint;
uniform sampler2D s_reflection;
out vec4 fragColor;
uniform vec4 u_scene;
uniform vec4 u_clock;
uniform vec4 u_color0;
uniform vec4 u_eye;
uniform vec4 u_style;
uniform vec4 u_atmosphere;
uniform vec4 u_tuning[22];
void main()
{
    vec2 uv = v_clip.xy/v_clip.w*0.5+0.5;
    
    vec2 disturbance = vec2(sin(v_world.z*0.009),-cos(v_world.x*0.007))*u_tuning[17].z;
    vec2 roughness = vec2(u_tuning[17].w,-u_tuning[18].x);
    vec3 reflection = texture(s_reflection,uv+disturbance).xyz*0.5;
    reflection += (texture(s_reflection,uv+disturbance+roughness).xyz
        +texture(s_reflection,uv+disturbance-roughness).xyz)*0.25;
    vec2 grid = abs(fract(vec2(v_world.x,v_world.z+u_clock.y)/u_tuning[17].x)-0.5);
    float grid_line = 1.0-smoothstep(0.001,0.006,min(grid.x,grid.y));
    float patches = 0.55+0.45*sin(v_world.x*0.002+sin(v_world.z*0.003));
    float fresnel=pow(1.0-max(0.0,normalize(u_eye.xyz-v_world).y),u_tuning[16].w);
    float pools=smoothstep(0.45,0.65,patches);
    vec3 rgb = reflection*(u_tuning[16].x+pools*u_tuning[16].y+fresnel*u_tuning[16].z)*u_tuning[19].w+u_color0.xyz*grid_line*u_scene.x*u_tuning[17].y;
    float distance = length(v_world-u_eye.xyz);
    float fog = exp(-distance*(u_tuning[18].y+u_scene.z*u_tuning[18].z));
    rgb = mix(u_tuning[19].xyz+u_atmosphere.xyz*u_tuning[18].w*u_scene.x,rgb,fog);
    fragColor = vec4(rgb,u_style.x);
}`;
export const fs_extract = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec2 v_uv;
in vec2 v_d3d;
uniform sampler2D s_source;
out vec4 fragColor;
void main()
{
    vec3 color = texture(s_source,v_uv).xyz;
    float brightness = max(color.x,max(color.y,color.z));
    fragColor = vec4(color*max(brightness-0.85,0.0)/max(brightness,0.0001),1.0);
}`;
export const fs_blur = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec2 v_uv;
in vec2 v_d3d;
uniform sampler2D s_source;
out vec4 fragColor;
uniform vec4 u_blur;
void main()
{
    vec2 offset = u_blur.xy;
    vec3 color = vec3(0.0,0.0,0.0);
    float total = 0.0;
    for(int i=-8;i<=8;++i) {
        float distance = float(i);
        float weight = exp(-distance*distance/32.0);
        color += texture(s_source,v_uv+offset*distance).xyz*weight;
        total += weight;
    }
    color /= total;
    fragColor = vec4(color,1.0);
}`;
export const fs_composite = `precision highp float;
precision highp int;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform mat4 u_viewProj;
uniform vec4 u_viewRect;
in vec2 v_uv;
in vec2 v_d3d;
uniform sampler2D s_source;
uniform sampler2D s_bloom;
out vec4 fragColor;
uniform vec4 u_post;
uniform mat4 u_sky;
uniform vec4 u_scene;
uniform vec4 u_clock;
uniform vec4 u_color0;
uniform vec4 u_color1;
uniform vec4 u_eye;
uniform vec4 u_style;
uniform vec4 u_atmosphere;
uniform vec4 u_theme;
uniform vec4 u_art;
uniform vec4 u_tuning[22];
uniform vec4 u_choreography[7];
uniform vec4 u_timer[5];
// Constelações (src/render/renderer.cpp, constellation_uniforms): [0..47] estrela na grelha do céu (x longitude, y
// latitude em células, como \`cells\`), z parte desenhada da ligação à seguinte (0..1), w presença da estrela;
// [48] opacidade das linhas, espessura (px), brilho extra dos graves, presença; [49] cor da fase e quanto a usar.
uniform vec4 u_constellation[50];
// Chuva hyperspace (src/render/renderer.cpp, rain_uniforms): [0] cor (a do cometa mais recente ou, no túnel, a dos anéis
// pares) e presença; [1] direções, fração com riscos, comprimento (fração do ciclo), espessura (px); [2] avanço (ciclos,
// volta a cada 2), brilho, quanto envolve todo o espaço (0 só o céu, 1 tudo); [3] cor dos anéis ímpares.
uniform vec4 u_rain[4];
float timer_box(vec2 position,vec2 center,vec2 extent,float softness)
{
    vec2 edge=abs(position-center)-extent;
    return 1.0-smoothstep(-softness,softness,max(edge.x,edge.y));
}
float timer_digit(vec2 position,float digit,float softness)
{
    float ink=0.0;
    if(digit!=1.0 && digit!=4.0)
        ink=max(ink,timer_box(position,vec2(0.25,0.08),vec2(0.17,0.045),softness));
    if(digit!=0.0 && digit!=1.0 && digit!=7.0)
        ink=max(ink,timer_box(position,vec2(0.25,0.5),vec2(0.17,0.045),softness));
    if(digit!=1.0 && digit!=4.0 && digit!=7.0)
        ink=max(ink,timer_box(position,vec2(0.25,0.92),vec2(0.17,0.045),softness));
    if(digit==0.0 || digit==4.0 || digit==5.0 || digit==6.0 || digit==8.0 || digit==9.0)
        ink=max(ink,timer_box(position,vec2(0.06,0.29),vec2(0.045,0.15),softness));
    if(digit==0.0 || digit==2.0 || digit==6.0 || digit==8.0)
        ink=max(ink,timer_box(position,vec2(0.06,0.71),vec2(0.045,0.15),softness));
    if(digit!=5.0 && digit!=6.0)
        ink=max(ink,timer_box(position,vec2(0.44,0.29),vec2(0.045,0.15),softness));
    if(digit!=2.0)
        ink=max(ink,timer_box(position,vec2(0.44,0.71),vec2(0.045,0.15),softness));
    return ink;
}
vec3 timer_overlay(vec3 color,vec2 screen_uv)
{
    if(u_timer[0].y<0.5 || u_timer[1].w<=0.0) return color;
    // Homografia por olho da mesma placa presa à cabeça: os dois visores fundem-se.
    vec3 screen_position=vec3(screen_uv,1.0);
    vec3 mapped=vec3(dot(u_timer[2].xyz,screen_position),dot(u_timer[3].xyz,screen_position),dot(u_timer[4].xyz,screen_position));
    if(mapped.z<=0.000001) return color;
    vec2 timer_position=mapped.xy/mapped.z;
    float softness=max(fwidth(timer_position.y)*0.65,0.006);
    float minutes=floor(u_timer[0].x/600.0);
    float seconds=mod(floor(u_timer[0].x/10.0),60.0);
    float ink=timer_digit(timer_position,floor(minutes/10.0),softness);
    ink=max(ink,timer_digit(timer_position-vec2(0.68,0.0),mod(minutes,10.0),softness));
    ink=max(ink,timer_box(timer_position,vec2(1.30,0.32),vec2(0.035,0.04),softness));
    ink=max(ink,timer_box(timer_position,vec2(1.30,0.68),vec2(0.035,0.04),softness));
    ink=max(ink,timer_digit(timer_position-vec2(1.58,0.0),floor(seconds/10.0),softness));
    ink=max(ink,timer_digit(timer_position-vec2(2.26,0.0),mod(seconds,10.0),softness));
    ink=max(ink,timer_box(timer_position,vec2(2.96,0.92),vec2(0.035,0.04),softness));
    ink=max(ink,timer_digit(timer_position-vec2(3.14,0.0),mod(u_timer[0].x,10.0),softness));
    vec2 edge=abs(timer_position-vec2(1.82,0.5))-vec2(1.98,0.62);
    float plate=1.0-smoothstep(-softness,softness,length(max(edge,vec2(0.0,0.0)))+min(max(edge.x,edge.y),0.0)-0.10);
    color=mix(color,vec3(0.0,0.0,0.0),plate*0.65*u_timer[1].w);
    vec3 ink_color=u_timer[0].w>0.5?vec3(0.10,1.0,0.20):vec3(0.95,0.97,1.0);
    if(u_post.y>0.5) ink_color=pow(ink_color,vec3(2.2,2.2,2.2));
    return mix(color,ink_color,ink*u_timer[1].w);
}
void main()
{
    vec3 color = texture(s_source,v_uv).xyz+texture(s_bloom,v_uv).xyz*u_post.x*u_tuning[14].x;
    vec3 direction = normalize(((u_sky)*(vec4(v_d3d*2.0-1.0,1.0,0.0))).xyz);
    // Pontos presos ao mundo: queda angular lenta, ciclo vertical periódico sem salto.
    vec2 cells=vec2((atan(direction.x,direction.z)/6.2831853+0.5)*u_tuning[12].x,
        asin(clamp(direction.y,-1.0,1.0))*u_tuning[12].y+u_tuning[21].w);
    vec2 index=floor(cells);
    index.x=mod(index.x,u_tuning[12].x);
    index.y=mod(index.y,u_tuning[12].z);
    float hash = fract(sin(dot(index,vec2(12.9898,78.233)))*43758.5453);
    float spark = (1.0-smoothstep(u_tuning[13].y,u_tuning[13].z,length(fract(cells)-0.5)))*step(1.0-u_tuning[13].x,hash);
    float empty=1.0-smoothstep(0.005,0.055,max(color.x,max(color.y,color.z)));
    float minimal=mix(1.0,u_tuning[15].x+(1.0-u_tuning[15].x)*smoothstep(0.0,u_tuning[15].y,u_art.z),u_art.w);
    float horizon=smoothstep(-0.04,0.15,direction.y)*(1.0-smoothstep(0.97,1.0,abs(direction.y)));
    color += spark*u_tuning[13].w*u_tuning[20].xyz*u_tuning[20].w*minimal*horizon*empty*u_scene.x;
    if(u_constellation[48].w>0.001)
    {
        // Estrelas iguais às do céu (mesmo perfil, mesma grelha, a descer com ele) e linhas de ~1 px entre elas, só no
        // céu vazio; as distâncias das linhas medem-se em píxeis com as derivadas locais da grelha.
        vec2 pixel=max(fwidth(cells),vec2(0.00001,0.00001));
        float stars=0.0;
        float lines=0.0;
        for(int i=0;i<48;++i)
        {
            vec4 s=u_constellation[i];
            if(s.w>0.0)
            {
                vec2 d=cells-s.xy;
                d.x-=u_tuning[12].x*floor(d.x/u_tuning[12].x+0.5);
                stars=max(stars,s.w*(1.0-smoothstep(u_tuning[13].y,u_tuning[13].z,length(d))));
                if(s.z>0.0 && i<47)
                {
                    vec2 e=u_constellation[i+1].xy-s.xy;
                    e.x-=u_tuning[12].x*floor(e.x/u_tuning[12].x+0.5);
                    vec2 a=d/pixel;
                    vec2 b=e/pixel;
                    float t=clamp(dot(a,b)/max(dot(b,b),0.000001),0.0,s.z);
                    float distance=length(a-b*t);
                    lines=max(lines,clamp(0.5*u_constellation[48].y+0.5-distance,0.0,1.0));
                }
            }
        }
        vec3 white=u_tuning[20].xyz*u_tuning[20].w;
        vec3 tinted=mix(white,u_constellation[49].xyz*max(white.x,max(white.y,white.z)),u_constellation[49].w);
        // As estrelas ligadas brilham um pouco mais do que as outras (o tamanho é o mesmo), para se lerem como vértices.
        color+=(stars*u_tuning[13].w*(1.8+u_constellation[48].z)+lines*u_constellation[48].x*0.5)*tinted
            *u_constellation[48].w*horizon*empty*u_scene.x;
    }
    if(u_rain[0].w>0.001)
    {
        // Chuva hyperspace: riscos finos que partem do ponto de fuga à frente do percurso (+z) e se afastam para os
        // lados e para trás, mais depressa à medida que se afastam (perspetiva). Só no céu vazio, como as estrelas.
        float away=acos(clamp(direction.z,-1.0,1.0));
        // Direção à volta do ponto de fuga; a costura fica a pique para baixo, abaixo do horizonte.
        float lane=(atan(direction.x,direction.y)/6.2831853+0.5)*u_rain[1].x;
        float along=log(max(tan(away*0.5),0.0001))/1.5;
        float id=floor(lane);
        float present=step(1.0-u_rain[1].y,fract(sin(id*12.9898)*43758.5453));
        float variant=fract(sin(id*78.233)*24634.6345);
        float speed=1.0+floor(variant*3.0)*0.5;
        float s=fract(along-u_rain[2].x*speed+variant*7.0);
        float tail=clamp((s-(1.0-u_rain[1].z))/u_rain[1].z,0.0,1.0);
        float pixel=max(fwidth(lane),0.00001);
        float stroke=clamp(0.5*u_rain[1].w+0.5-abs(fract(lane)-0.5)/pixel,0.0,1.0);
        // Perto do ponto de fuga as direções juntam-se em menos de um píxel: os riscos nascem já afastados dele.
        float vanish=smoothstep(0.10,0.45,away)*(1.0-smoothstep(0.35,1.0,pixel));
        // No túnel envolvem todo o espaço (também abaixo do horizonte), sempre só onde a cena está vazia.
        float space=mix(horizon,1.0,u_rain[2].z);
        vec3 tint=mix(u_rain[0].xyz,u_rain[3].xyz,step(0.5,fract(sin(id*37.719)*12345.678)));
        // No túnel o bloom dos anéis enche o fundo: o vazio mede-se só na cena, sem o bloom.
        vec3 base=texture(s_source,v_uv).xyz;
        float clear=mix(empty,1.0-smoothstep(0.02,0.25,max(base.x,max(base.y,base.z))),u_rain[2].z);
        color+=tint*(tail*tail*stroke*present*vanish*u_rain[2].y*u_rain[0].w)*space*clear*u_scene.x;
    }
    if(u_post.w>0.0)
    {
        float horizon=pow(1.0-abs(direction.y),3.0);
        vec3 skyPoint=direction*vec3(3.0,4.0,3.0);
        float cloud=0.5+0.5*sin(skyPoint.x*3.0+sin(skyPoint.z*4.0)+u_clock.x*0.013);
        cloud*=0.5+0.5*sin(skyPoint.x*6.0-skyPoint.y*8.0);
        vec3 horizonColor=u_atmosphere.xyz*0.5+u_color1.xyz*0.018;
        vec3 clouds=mix(u_atmosphere.xyz*0.20,u_color0.xyz*0.09,cloud)*cloud;
        color+=(horizonColor*horizon+clouds*smoothstep(0.0,0.3,direction.y))*u_post.w*empty*u_scene.x;
    }
    if(u_post.z>0.0)
    {
        vec3 distant=normalize(vec3(0.0,260.0,18000.0)-u_eye.xyz);
        float axial=max(0.0,dot(direction,distant));
        float core=pow(axial,230.0);
        float halo=pow(axial,5.0);
        vec3 mistPoint=u_eye.xyz+direction*7000.0;
        float clouds=0.55+0.45*sin(mistPoint.x*0.0007+sin(mistPoint.y*0.001)+u_clock.x*0.07);
        vec3 glowColour=u_style.z>0.5?u_choreography[5].xyz:u_color1.xyz;
        float glowGain=u_style.z>0.5?u_choreography[5].w:1.0;
        vec3 atmosphere=glowColour*(core*0.8+halo*clouds*0.036+0.008)
            +mix(u_color0.xyz,u_color1.xyz,halo)*clouds*0.006*u_scene.z;
        color+=(atmosphere+u_atmosphere.xyz*halo*0.10)*u_scene.x*u_post.z*u_choreography[3].x*glowGain;
    }
    color+=u_theme.xyz*(0.2+0.8*pow(1.0-abs(direction.y),3.0))*mix(1.0,empty,u_theme.w)*u_scene.x;
    color *= u_tuning[14].y;
    if(u_tuning[14].w>0.5) color = (color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14);
    color=clamp(color,0.0,1.0);
    if(u_post.y<0.5) color = pow(color,vec3(1.0/u_tuning[15].z,1.0/u_tuning[15].z,1.0/u_tuning[15].z));
    float vignette = 1.0-u_tuning[14].z*pow(length((v_d3d-0.5)*u_tuning[15].w),2.0);
    // Composição final após exposição e bloom, fora da cena e das reflexões.
    // A saída final apaga também pontos, brilho de fundo e contador.
    fragColor = vec4(color*vignette*u_atmosphere.w,1.0);
}`;
export const vs_quad = `precision highp float;
in vec3 a_position;
out vec2 v_uv;
out vec2 v_d3d;
void main()
{
    gl_Position = vec4(a_position.xy,0.0,1.0);
    v_uv = a_position.xy*0.5+0.5;
    v_d3d = vec2(v_uv.x,1.0-v_uv.y);
}
`;
