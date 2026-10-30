// Exportador de dados para a versão web (three.js) do Silent Orbit.
// Corre a mesma preparação do arranque do renderer C++ (src/render/renderer.cpp, Impl::Impl) sem bgfx:
// carrega a Opening, estende a Intro, limpa o percurso, reduz para a versão minimal, gera a extensão e o túnel,
// converte todas as malhas em pontos e analisa os graves da música. Grava:
//   manifest.json  configuração resolvida (todas as Setting), cores, grupos, malhas e secções do binário
//   scene.bin      malhas (pontos comprimidos ou superfícies), instâncias (20 floats), envelope e ataques dos graves
// Uso: web_export <pasta Prismatic-Pontos> <config.json> <musica.wav> <pasta de saída>
#include "render/opening_scene.hpp"
#include "render/art_direction.hpp"
#include "render/mini_poles.hpp"
#include "render/dot_geometry.hpp"
#include "render/spectral_geometry.hpp"
#include "render/surface_choreography.hpp"
#include "audio/beat_envelope.hpp"
#include "config/visual_config.hpp"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <optional>
#include <unordered_map>

namespace fantasynt {
// Definidas em mesh.cpp (bgfx); copiadas aqui sem os buffers.
SurfaceGeometry make_box_geometry() {
    const std::array<SurfaceVertex,24> v{{
        {-1,-1,-1,0,0,-1},{1,-1,-1,0,0,-1},{1,1,-1,0,0,-1},{-1,1,-1,0,0,-1},
        {1,-1,1,0,0,1},{-1,-1,1,0,0,1},{-1,1,1,0,0,1},{1,1,1,0,0,1},
        {-1,-1,1,-1,0,0},{-1,-1,-1,-1,0,0},{-1,1,-1,-1,0,0},{-1,1,1,-1,0,0},
        {1,-1,-1,1,0,0},{1,-1,1,1,0,0},{1,1,1,1,0,0},{1,1,-1,1,0,0},
        {-1,1,-1,0,1,0},{1,1,-1,0,1,0},{1,1,1,0,1,0},{-1,1,1,0,1,0},
        {-1,-1,1,0,-1,0},{1,-1,1,0,-1,0},{1,-1,-1,0,-1,0},{-1,-1,-1,0,-1,0}}};
    SurfaceGeometry g{{v.begin(),v.end()},{}};
    for(std::uint16_t face=0;face<6;++face) {
        const auto b=static_cast<std::uint16_t>(face*4);
        for(auto i:{b,static_cast<std::uint16_t>(b+1),static_cast<std::uint16_t>(b+2),static_cast<std::uint16_t>(b+2),static_cast<std::uint16_t>(b+3),b})
            g.indices.push_back(i);
    }
    return g;
}
}
using namespace fantasynt;
using Json=nlohmann::json;
#include "setting_names.inc"
#include "colour_names.inc"

namespace {
// ---- cópias de renderer.cpp (namespace anónimo e Impl) ----
template<class KeepAll>
void thin_instances(std::vector<Instance>& items,double share,double seed,KeepAll keep_all) {
    if(share>=1) return;
    std::unordered_map<int,std::size_t> seen;
    std::vector<Instance> kept;
    kept.reserve(items.size());
    for(const auto& item:items) {
        if(keep_all(item)) { kept.push_back(item); continue; }
        const auto n=seen[static_cast<int>(item.variation)]++;
        const double rank=std::fmod((static_cast<double>(n)+0.5)*0.6180339887498949+seed+item.variation*0.7548776662466927,1.0);
        if(rank<share) kept.push_back(item);
    }
    items.swap(kept);
}
void thin_opening(OpeningScene& scene,const VisualConfig& c) {
    if(c[Setting::RemoveFloorCables]) std::erase_if(scene.groups,[](const OpeningGroup& group) { return group.mesh.starts_with("floor_cables"); });
    if(c[Setting::RemoveGrass]) std::erase_if(scene.groups,[](const OpeningGroup& group) { return group.mesh.starts_with("SM_grass"); });
    if(c[Setting::RemoveSlantedPoles]) std::erase_if(scene.groups,[](const OpeningGroup& group) { return group.mesh.starts_with("SM_Pole_Map"); });
    for(std::size_t g=0;g<scene.groups.size();++g) {
        const double share=c[Setting::ElementShare]*(scene.groups[g].mesh.starts_with("SM_grass")?c[Setting::DotGrassShare]:1.0);
        thin_instances(scene.groups[g].instances,share,static_cast<double>(g)*0.7548776662466927,[](const Instance&) { return false; });
    }
    std::erase_if(scene.groups,[](const OpeningGroup& group) { return group.instances.empty(); });
}
bool keeps_surface(const std::string& mesh) { return mesh.find("FogSheet")!=mesh.npos; }

struct Exporter {
    VisualConfig visual;
    OpeningScene opening;
    std::array<std::vector<Instance>,2> extension_scenes;
    std::vector<Instance> directed_tunnel;
    BeatEnvelope beats;
    std::vector<char> blob;
    Json meshes=Json::object();
    std::size_t dot_points{};

    void align() { while(blob.size()%8) blob.push_back(0); }
    Json section(const void* data,std::size_t bytes) {
        align();
        const auto offset=blob.size();
        blob.insert(blob.end(),static_cast<const char*>(data),static_cast<const char*>(data)+bytes);
        return {{"offset",offset},{"bytes",bytes}};
    }
    Json instances(const std::vector<Instance>& items) {
        static_assert(sizeof(Instance)==80);
        auto s=section(items.data(),items.size()*sizeof(Instance));
        s["count"]=items.size();
        return s;
    }
    // Malha de pontos: um registo de 8 floats por ponto (posição, normal unitária, uv); os quatro cantos (normal ×2..5)
    // são expandidos no browser. Superfícies: vértices de 8 floats e índices de 16 bits.
    void store_mesh(const std::string& id,const SurfaceGeometry& g) {
        const bool dots=!g.vertices.empty()&&std::abs(std::hypot(g.vertices[0].nx,g.vertices[0].ny,g.vertices[0].nz)-2.0f)<0.01f;
        Json entry;
        if(dots) {
            std::vector<float> points;
            points.reserve(g.vertices.size()/4*8);
            for(std::size_t i=0;i<g.vertices.size();i+=4) {
                const auto& v=g.vertices[i];
                points.insert(points.end(),{v.x,v.y,v.z,v.nx*0.5f,v.ny*0.5f,v.nz*0.5f,v.u,v.v});
            }
            entry=section(points.data(),points.size()*sizeof(float));
            entry["kind"]="dots"; entry["points"]=g.vertices.size()/4;
        } else {
            entry["kind"]="surface";
            entry["vertices"]=section(g.vertices.data(),g.vertices.size()*sizeof(SurfaceVertex));
            entry["vertex_count"]=g.vertices.size();
            entry["indices"]=section(g.indices.data(),g.indices.size()*2);
            entry["index_count"]=g.indices.size();
        }
        meshes[id]=entry;
    }
    SurfaceGeometry dotted(const SurfaceGeometry& geometry,const DotScaleSampler& scale,std::optional<ArtRole> role={}) {
        if(!visual[Setting::DotsEnabled]) return geometry;
        DotSettings settings;
        settings.edge_spacing=static_cast<float>(visual[Setting::DotEdgeSpacing]*100);
        settings.face_spacing=static_cast<float>(visual[Setting::DotFaceSpacing]*100);
        settings.feature_angle_degrees=static_cast<float>(visual[Setting::DotFeatureAngle]);
        const auto budget=static_cast<std::size_t>(visual[Setting::DotMeshBudget])/std::max<std::size_t>(1,scale.count());
        const auto limit=role==ArtRole::Pyramid?visual[Setting::DotPyramidMaxPoints]:visual[Setting::DotMaxPerMesh];
        settings.max_points=std::clamp<std::size_t>(std::min(role==ArtRole::Pyramid?dot_point_limit:budget,static_cast<std::size_t>(limit)),1,dot_point_limit);
        settings.single_point=role==ArtRole::Point&&visual[Setting::DotPointsSingle];
        DotStats stats;
        auto points=make_dot_geometry(geometry,scale.median(),settings,&stats);
        dot_points+=stats.points;
        return points;
    }
    void organise_tunnel_bars(const VisualConfig& c) {
        const int per_ring=static_cast<int>(c[Setting::ProtoTunnelBarsPerRing]);
        if(per_ring<=0||c[Setting::ProtoTunnelRadius]<=0) return;
        std::vector<Instance*> bars;
        for(auto& item:directed_tunnel) if(item.variation==3) bars.push_back(&item);
        std::stable_sort(bars.begin(),bars.end(),[](const Instance* a,const Instance* b) { return a->transform[14]<b->transform[14]; });
        const double spacing=c[Setting::ProtoTunnelRingSpacing]*100,radius=c[Setting::ProtoTunnelRadius]*100;
        const auto rings=static_cast<std::size_t>(std::max(1.0,std::floor(41600/spacing)));
        const float length=static_cast<float>(c[Setting::ProtoTunnelBarLength]*50),width=static_cast<float>(c[Setting::ProtoTunnelBarWidth]*50);
        for(std::size_t i=0;i<bars.size();++i) {
            auto& m=bars[i]->transform;
            const std::size_t ring=i/static_cast<std::size_t>(per_ring),slot=i%static_cast<std::size_t>(per_ring);
            const double angle=6.283185307179586*(static_cast<double>(slot)+(ring%2?0.5:0.0))/per_ring;
            const float ca=static_cast<float>(std::cos(angle)),sa=static_cast<float>(std::sin(angle));
            m={sa*width,-ca*width,0,0, ca*width,sa*width,0,0, 0,0,length,0,
                static_cast<float>(ca*radius),static_cast<float>(260+sa*radius),static_cast<float>(ring*spacing),1};
            if(ring>=rings) bars[i]->padding=1;
        }
    }
    void prepare_tunnel_order(const VisualConfig& c) {
        directed_tunnel=make_directed_tunnel_instances(20261011);
        thin_instances(directed_tunnel,c[Setting::ElementShare],0.53,[](const Instance& item) { return item.variation==5; });
        organise_tunnel_bars(c);
        const auto reference=directed_camera_position(c[Setting::TunnelStart],c);
        for(auto& item:directed_tunnel) {
            if(item.variation==5) continue;
            double z=std::fmod(item.transform[14]-reference+41600+1600,41600);
            if(z<0) z+=41600;
            const double angle=(std::atan2(item.transform[13]-260,item.transform[12])/6.283185307179586+0.5);
            item.phase=static_cast<float>(std::clamp((std::floor(z/650)+angle)/64,0.0,1.0));
        }
    }
    void prepare_extensions(const VisualConfig& c) {
        extension_scenes={make_landscape_instances(20261011,4096,false,c),make_landscape_instances(20261011,4096,true,c)};
        for(auto& items:extension_scenes) {
            for(auto& item:items) if(item.variation==8) {
                const float x=std::hypot(item.transform[0],item.transform[2]),z=std::hypot(item.transform[8],item.transform[10]);
                if(z>0) { item.transform[8]*=x/z; item.transform[10]*=x/z; }
            }
            clear_extension_route(items,c);
        }
        separate_ground_rocks(extension_scenes[0],extension_scenes[1],c);
        for(std::size_t i=0;i<extension_scenes.size();++i)
            thin_instances(extension_scenes[i],c[Setting::ElementShare],0.17+0.4*i,[](const Instance& item) { return item.variation==2; });
    }
    void make_procedural_meshes() {
        const auto merged=[&](std::initializer_list<int> ids) {
            DotScaleSampler result;
            for(const auto* items:{&extension_scenes[0],&extension_scenes[1],&directed_tunnel})
                for(const auto& item:*items) for(int id:ids) if(static_cast<int>(item.variation)==id) result.add(item);
            return result;
        };
        store_mesh("box",dotted(make_box_geometry(),merged({0,1,10,11,14,15})));
        store_mesh("sphere",dotted(make_sphere_geometry(),merged({4,7})));
        store_mesh("torus",dotted(make_torus_geometry(),merged({5})));
        DotScaleSampler rings;
        const double formed=visual[Setting::RingAlignStart]+visual[Setting::RingAlignDuration]*2;
        for(const auto& item:directed_tunnel) if(item.variation==5)
            rings.add(directed_tunnel_instance(item,formed,0,0,visual,1,0,0,0));
        store_mesh("ring_torus",dotted(make_torus_geometry(),rings));
        {
            const auto count=std::clamp<std::size_t>(static_cast<std::size_t>(visual[Setting::CometLength]/visual[Setting::CometSpacing])+1,8,dot_point_limit);
            std::vector<SurfaceVertex> points;
            for(std::size_t i=0;i<count;++i) {
                const float y=2.0f*static_cast<float>(i)/static_cast<float>(count-1);
                points.push_back({0,y,0,0,1,0,0,y*0.5f});
            }
            store_mesh("cone_line",make_dot_points(points));
        }
        store_mesh("ribbon",dotted(make_ribbon_geometry(),merged({6})));
        store_mesh("panel",dotted(make_panel_geometry(),merged({3})));
        store_mesh("diamond",dotted(make_diamond_geometry(),merged({12})));
        store_mesh("plate",dotted(make_plate_geometry(),merged({13})));
        const auto cones=merged({9});
        for(int piece=0;piece<spectral_cone_piece_count;++piece)
            store_mesh("cone_"+std::to_string(piece),dotted(make_luminous_cone_piece_geometry(piece),cones));
        const auto rocks=merged({8});
        for(int variant=0;variant<crystal_variant_count;++variant) for(int piece=0;piece<crystal_piece_count;++piece)
            store_mesh("crystal_"+std::to_string(variant)+"_"+std::to_string(piece),dotted(make_crystal_piece_geometry(variant,piece),rocks));
        // Chão (make_ground): quadrado unitário em y=0, desenhado como superfície.
        SurfaceGeometry ground{{{-1,0,-1,0,1,0},{1,0,-1,0,1,0},{1,0,1,0,1,0},{-1,0,1,0,1,0}},{0,1,2,2,3,0}};
        store_mesh("ground",ground);
    }
    static bool stair_group(const OpeningGroup& group) { return group.role==ArtRole::Pulse&&!group.mesh.starts_with("SM_PoleDot"); }
    // Cópia de Impl::stair_circles: o resultado não depende do frame (só da música, da cena e da configuração).
    Json stair_circles() {
        Json out=Json::array();
        const int count=static_cast<int>(visual[Setting::DotStairSteps]);
        if(count<=0||!visual[Setting::DotsEnabled]) return out;
        std::vector<double> onsets;
        for(double onset:beats.onsets()) {
            const double scene=onset-visual[Setting::PulseOffset];
            if(scene>=visual[Setting::DotStairStart]) onsets.push_back(scene);
        }
        if(onsets.empty()) return out;
        const double camera=directed_camera_position(onsets.front(),visual);
        const double target=camera+visual[Setting::DotStairDistance]*100;
        const double half=(visual[Setting::CorridorWidth]*0.5+visual[Setting::CorridorMargin])*100;
        const double radius=visual[Setting::DotStairCluster]*100;
        struct Entry { std::size_t group; const Instance* item; };
        std::vector<Entry> ground,diamonds;
        for(std::size_t g=0;g<opening.groups.size();++g) {
            const auto& group=opening.groups[g];
            if(group.stage!=OpeningStage::Forest||directed_group_start(group,visual)>onsets.front()) continue;
            if(stair_group(group)) { for(const auto& item:group.instances) if(item.transform[13]<=50) ground.push_back({g,&item}); }
            else if(group.mesh.find("iamond")!=std::string::npos&&group.name.find("Void")==std::string::npos)
                for(const auto& item:group.instances) diamonds.push_back({g,&item});
        }
        const auto near=[&](const Instance& a,const Instance& b) { return std::hypot(a.transform[12]-b.transform[12],a.transform[14]-b.transform[14])<=radius; };
        const Instance* centre=nullptr;
        std::size_t most=0; double nearest=std::numeric_limits<double>::max();
        for(const auto& e:ground) {
            const auto& t=e.item->transform;
            if(t[12]>-half||t[12]<-2000||t[14]<camera+800||t[14]>camera+4000) continue;
            std::size_t neighbours=0;
            for(const auto& other:ground) neighbours+=near(*other.item,*e.item);
            const double distance=std::abs(t[14]-target);
            if(neighbours>most||(neighbours==most&&distance<nearest)) { most=neighbours; nearest=distance; centre=e.item; }
        }
        if(!centre) return out;
        std::vector<Entry> members;
        for(const auto& circle:ground) if(near(*circle.item,*centre)) members.push_back(circle);
        std::stable_sort(members.begin(),members.end(),[](const Entry& a,const Entry& b) { return a.item->transform[14]<b.item->transform[14]; });
        const Entry* anchor=nullptr;
        double closest=visual[Setting::DotStairDiamond]*100;
        for(const auto& entry:diamonds) {
            const double distance=std::hypot(entry.item->transform[12]-centre->transform[12],entry.item->transform[14]-centre->transform[14]);
            if(distance<=closest) { closest=distance; anchor=&entry; }
        }
        double low=members.front().item->transform[14],high=members.back().item->transform[14];
        if(anchor) { low=std::min<double>(low,anchor->item->transform[14]); high=std::max<double>(high,anchor->item->transform[14]); }
        const double step=high-low+visual[Setting::DotStairForward]*100;
        const float side=centre->transform[12]<0?1.0f:-1.0f;
        const double slope=std::tan(visual[Setting::DotStairElevation]*0.0174532925199433);
        const double eye=visual[Setting::EyeHeight]*100;
        const auto every=static_cast<std::size_t>(visual[Setting::DotStairBeats]);
        const auto place=[&](std::size_t group,Instance instance,double time,double fade_in,int copy) {
            auto& t=instance.transform;
            t[12]+=side*static_cast<float>(copy*visual[Setting::DotStairSide]*100);
            t[14]+=static_cast<float>(copy*step);
            const double eye_z=directed_camera_position(time,visual)-visual[Setting::EyeBack]*100;
            const double ceiling=eye+slope*std::max(0.0,t[14]-eye_z);
            t[13]+=static_cast<float>(std::clamp<double>(ceiling-t[13],0.0,copy*visual[Setting::DotStairRise]*100));
            t[3]=1;
            out.push_back({{"group",group},{"time",time},{"fade_in",fade_in},
                {"instance",std::vector<float>(reinterpret_cast<const float*>(&instance),reinterpret_cast<const float*>(&instance)+20)}});
        };
        std::size_t beat=0;
        for(int copy=1;copy<=count;++copy) {
            if(beat>=onsets.size()) break;
            if(anchor) place(anchor->group,*anchor->item,onsets[beat],std::max(0.15,0.5*visual[Setting::DotStairBeats]),copy);
            for(const auto& m:members) {
                if(beat>=onsets.size()) break;
                place(m.group,*m.item,onsets[beat],0.15,copy);
                beat+=every;
            }
        }
        return out;
    }
};
std::vector<std::int16_t> read_wav(const std::filesystem::path& path,int& rate,int& channels) {
    std::ifstream f(path,std::ios::binary);
    if(!f) throw std::runtime_error("WAV em falta: "+path.string());
    std::vector<char> data((std::istreambuf_iterator<char>(f)),{});
    if(data.size()<12||std::memcmp(data.data(),"RIFF",4)||std::memcmp(data.data()+8,"WAVE",4)) throw std::runtime_error("WAV inválido");
    std::size_t p=12; int bits=0; rate=0; channels=0;
    while(p+8<=data.size()) {
        std::uint32_t size; std::memcpy(&size,data.data()+p+4,4);
        if(!std::memcmp(data.data()+p,"fmt ",4)) {
            std::uint16_t format,ch; std::uint32_t sr; std::uint16_t bps;
            std::memcpy(&format,data.data()+p+8,2); std::memcpy(&ch,data.data()+p+10,2);
            std::memcpy(&sr,data.data()+p+12,4); std::memcpy(&bps,data.data()+p+22,2);
            rate=static_cast<int>(sr); channels=ch; bits=bps;
            if(format!=1&&format!=0xFFFE) throw std::runtime_error("WAV: só PCM");
        } else if(!std::memcmp(data.data()+p,"data",4)) {
            if(bits!=16) throw std::runtime_error("WAV: esperava PCM16");
            const auto n=std::min<std::size_t>(size,data.size()-p-8)/2;
            std::vector<std::int16_t> pcm(n);
            std::memcpy(pcm.data(),data.data()+p+8,n*2);
            return pcm;
        }
        p+=8+size+(size&1);
    }
    throw std::runtime_error("WAV sem dados");
}
}

int main(int argc,char** argv) {
    if(argc!=5) { std::cerr<<"web_export <pasta Prismatic-Pontos> <config.json> <musica.wav> <saida>\n"; return 2; }
    try {
        const std::filesystem::path root=argv[1],out=argv[4];
        Exporter e;
        e.visual=load_visual_config(argv[2]);
        const auto& visual=e.visual;
        // Mesma ordem do construtor do renderer.
        auto original=load_opening_scene(root/"assets"/"opening");
        prepare_mini_poles(original);
        e.opening=original;
        extend_opening_intro(e.opening,visual);
        const auto adjusted=clear_directed_route(e.opening,visual);
        thin_opening(e.opening,visual);
        e.prepare_extensions(visual);
        e.prepare_tunnel_order(visual);
        e.make_procedural_meshes();
        int rate=0,channels=0;
        const auto pcm=read_wav(argv[3],rate,channels);
        e.beats=BeatEnvelope::analyze(pcm,rate,channels,visual);
        // Malhas da Opening, em pontos com a escala mediana das instâncias de cada malha.
        std::unordered_map<std::string,DotScaleSampler> scales;
        std::unordered_map<std::string,ArtRole> roles;
        for(const auto& group:e.opening.groups) {
            roles.emplace(group.mesh,group.role);
            for(const auto& item:group.instances) scales[group.mesh].add(item);
        }
        Json radii=Json::object();
        for(const auto& [id,geometry]:e.opening.meshes) {
            const auto found=scales.find(id);
            e.store_mesh(id,keeps_surface(id)?geometry:e.dotted(geometry,found==scales.end()?DotScaleSampler{}:found->second,
                roles.contains(id)?std::optional<ArtRole>(roles.at(id)):std::nullopt));
            float radius{};
            for(const auto& v:geometry.vertices) radius=std::max(radius,std::hypot(v.x,v.y,v.z));
            radii[id]=radius;
        }
        Json groups=Json::array();
        for(const auto& g:e.opening.groups) {
            groups.push_back({{"name",g.name},{"mesh",g.mesh},{"stage",static_cast<int>(g.stage)},{"material",g.material},
                {"cull_distance",g.cull_distance},{"start_time",g.start_time},{"role",static_cast<int>(g.role)},
                {"floor_anchored",g.floor_anchored},{"shaft_height",g.shaft_height},{"bounds_min",g.bounds_min},
                {"bounds_max",g.bounds_max},{"pivot",g.pivot},{"instances",e.instances(g.instances)}});
        }
        Json settings=Json::object();
        for(std::size_t i=0;i<static_cast<std::size_t>(Setting::Count);++i) settings[setting_names[i]]=visual[static_cast<Setting>(i)];
        Json colours=Json::object();
        for(std::size_t i=0;i<static_cast<std::size_t>(ConfigColour::Count);++i) {
            const auto c=visual.colour(static_cast<ConfigColour>(i));
            colours[colour_names[i]]={c.r,c.g,c.b};
        }
        Json families=Json::array();
        for(int r=0;r<7;++r) {
            const auto role=static_cast<ArtRole>(r);
            const auto c=visual.family_colour(role);
            families.push_back({{"enabled",visual.family_enabled(role)},{"density",visual.family_density(role)},
                {"emission",visual.family_emission(role)},{"colour",{c.r,c.g,c.b}}});
        }
        const auto& p=visual.parameters;
        Json parameters={{"palette",{{p.palette[0].r,p.palette[0].g,p.palette[0].b},{p.palette[1].r,p.palette[1].g,p.palette[1].b}}},
            {"light_intensity",p.light_intensity},{"motion_speed",p.motion_speed},{"pulse_strength",p.pulse_strength},
            {"fog_density",p.fog_density},{"geometry_density",p.geometry_density},{"bloom",p.bloom}};
        // Envelope dos graves (100 Hz) e ataques (segundos da música).
        std::vector<float> envelope;
        for(std::size_t i=0;;++i) {
            const double t=static_cast<double>(i)/100;
            if(t>e.beats.duration_seconds()+0.02) break;
            envelope.push_back(e.beats.sample(t));
        }
        const auto& onsets=e.beats.onsets();
        Json manifest={{"schema",1},{"settings",settings},{"colours",colours},{"families",families},{"parameters",parameters},
            {"groups",groups},{"radii",radii},{"meshes",e.meshes},
            {"extension",{e.instances(e.extension_scenes[0]),e.instances(e.extension_scenes[1])}},
            {"tunnel",e.instances(e.directed_tunnel)},
            {"beats",{{"rate",100},{"duration",e.beats.duration_seconds()},{"envelope",e.section(envelope.data(),envelope.size()*4)},
                {"envelope_count",envelope.size()},{"onsets",e.section(onsets.data(),onsets.size()*8)},{"onset_count",onsets.size()}}},
            {"stair",e.stair_circles()},{"route_adjustments",adjusted},{"dot_points",e.dot_points},{"bytes",e.blob.size()}};
        std::filesystem::create_directories(out);
        std::ofstream(out/"scene.bin",std::ios::binary).write(e.blob.data(),static_cast<std::streamsize>(e.blob.size()));
        std::ofstream(out/"manifest.json")<<manifest.dump();
        std::cout<<"grupos "<<groups.size()<<", malhas "<<e.meshes.size()<<", pontos/malha "<<e.dot_points<<", "<<e.blob.size()/1048576.0<<" MB, ataques "<<onsets.size()<<"\n";
    } catch(const std::exception& error) { std::cerr<<"Erro: "<<error.what()<<"\n"; return 1; }
}
