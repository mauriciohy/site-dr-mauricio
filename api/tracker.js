const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// ===== RATE LIMITING =====
const rateLimit = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimit.get(ip);
    if (!entry || now - entry.start > 60000) {
        rateLimit.set(ip, { count: 1, start: now });
        return false;
    }
    return ++entry.count > 30;
}

// ===== GOOGLE SHEETS =====
async function getSheets() {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    return google.sheets({ version: 'v4', auth });
}

const SITE_TABS = {
    'Dr. Mauricio Yamada':      'Site Principal',
    'Radiofrequência Maringá':  'Radiofrequência',
    'Espuma Maringá':           'Espuma',
    'Doppler Maringá':          'Doppler'
};

// ============================================================
// ===== CACHE DO MODELO — carrega do Sheets automaticamente =====
// ============================================================

// Cache em memória (persiste enquanto o processo Vercel estiver vivo)
let _modeloCache     = null;   // pesos carregados do Sheets
let _modeloCacheTime = 0;      // timestamp do último carregamento
const CACHE_TTL_MS   = 15 * 60 * 1000; // 15 minutos

// Pesos de fallback (usados se Sheets falhar ou aba não existir ainda)
const MODELO_FALLBACK = {
    bias_global: -1.2,
    sites: {
        'Site Principal': {
            bias: -1.0,
            weights: {
                tempo_ativo_segundos: 0.015, scroll_max_pct: 0.012, total_cliques: 0.045, tab_switches: -0.10,
                viu_tratamentos: 0.65, viu_reviews: 0.60, viu_qualificacoes: 0.50, viu_convenios: 0.55, viu_localizacao: 0.55,
                clicou_maps: 0.80, clicou_blog: 0.30, clicou_phone: 0.65,
                botao_principal: 0.40, botao_flutuante: 0.30, botao_header: 0.32,
                cidade_maringa: 0.85, cidade_regiao: 0.45, estado_parana: 0.25,
                mobile: 0.25, ios: 0.15, touch: 0.12, conexao_wifi: 0.10, bateria_baixa: -0.18,
                primeira_visita: -0.30, retorno: 0.55,
                horario_pico: 0.35, horario_comercial: 0.15, dia_util: 0.20,
                google_ads: 0.50, organico: 0.25, direct: -0.05, fbclid: 0.25, tem_gclid: 0.48,
                tem_utm_campaign: 0.28, tem_utm_term: 0.28,
                proxy_vpn: -0.80, datacenter_ip: -1.00,
            }
        },
        'Blog': {
            bias: -1.5,
            weights: {
                tempo_ativo_segundos: 0.020, scroll_max_pct: 0.015, total_cliques: 0.040, tab_switches: -0.12,
                viu_tratamentos: 0.70, viu_reviews: 0.65, viu_qualificacoes: 0.50, viu_convenios: 0.45, viu_localizacao: 0.40,
                clicou_maps: 0.75, clicou_blog: 0.20, clicou_phone: 0.60,
                botao_principal: 0.40, botao_flutuante: 0.30, botao_header: 0.35,
                cidade_maringa: 0.90, cidade_regiao: 0.45, estado_parana: 0.30,
                mobile: 0.20, ios: 0.15, touch: 0.10, conexao_wifi: 0.10, bateria_baixa: -0.20,
                primeira_visita: -0.50, retorno: 0.80,
                horario_pico: 0.35, horario_comercial: 0.15, dia_util: 0.20,
                google_ads: 0.55, organico: 0.30, direct: -0.10, fbclid: 0.25, tem_gclid: 0.50,
                tem_utm_campaign: 0.30, tem_utm_term: 0.25,
                proxy_vpn: -0.80, datacenter_ip: -1.00,
            }
        },
        'Doppler': {
            bias: -0.8,
            weights: {
                tempo_ativo_segundos: 0.010, scroll_max_pct: 0.008, total_cliques: 0.050, tab_switches: -0.08,
                viu_tratamentos: 0.55, viu_reviews: 0.60, viu_qualificacoes: 0.40, viu_convenios: 0.70, viu_localizacao: 0.65,
                clicou_maps: 0.90, clicou_blog: 0.15, clicou_phone: 0.70,
                botao_principal: 0.45, botao_flutuante: 0.35, botao_header: 0.30,
                cidade_maringa: 0.85, cidade_regiao: 0.50, estado_parana: 0.25,
                mobile: 0.30, ios: 0.10, touch: 0.15, conexao_wifi: 0.05, bateria_baixa: -0.15,
                primeira_visita: -0.20, retorno: 0.50,
                horario_pico: 0.40, horario_comercial: 0.20, dia_util: 0.25,
                google_ads: 0.50, organico: 0.25, direct: 0.00, fbclid: 0.20, tem_gclid: 0.45,
                tem_utm_campaign: 0.25, tem_utm_term: 0.30,
                proxy_vpn: -0.80, datacenter_ip: -1.00,
            }
        },
        'Radiofrequência': {
            bias: -0.6,
            weights: {
                tempo_ativo_segundos: 0.012, scroll_max_pct: 0.012, total_cliques: 0.055, tab_switches: -0.10,
                viu_tratamentos: 0.80, viu_reviews: 0.75, viu_qualificacoes: 0.65, viu_convenios: 0.50, viu_localizacao: 0.45,
                clicou_maps: 0.70, clicou_blog: 0.30, clicou_phone: 0.65,
                botao_principal: 0.40, botao_flutuante: 0.30, botao_header: 0.35,
                cidade_maringa: 0.80, cidade_regiao: 0.55, estado_parana: 0.30,
                mobile: 0.25, ios: 0.20, touch: 0.10, conexao_wifi: 0.15, bateria_baixa: -0.20,
                primeira_visita: -0.30, retorno: 0.70,
                horario_pico: 0.35, horario_comercial: 0.15, dia_util: 0.20,
                google_ads: 0.60, organico: 0.25, direct: -0.05, fbclid: 0.30, tem_gclid: 0.55,
                tem_utm_campaign: 0.35, tem_utm_term: 0.30,
                proxy_vpn: -0.80, datacenter_ip: -1.00,
            }
        },
        'Espuma': {
            bias: -0.7,
            weights: {
                tempo_ativo_segundos: 0.011, scroll_max_pct: 0.011, total_cliques: 0.048, tab_switches: -0.09,
                viu_tratamentos: 0.75, viu_reviews: 0.65, viu_qualificacoes: 0.55, viu_convenios: 0.60, viu_localizacao: 0.50,
                clicou_maps: 0.75, clicou_blog: 0.25, clicou_phone: 0.60,
                botao_principal: 0.42, botao_flutuante: 0.32, botao_header: 0.32,
                cidade_maringa: 0.85, cidade_regiao: 0.50, estado_parana: 0.25,
                mobile: 0.28, ios: 0.15, touch: 0.12, conexao_wifi: 0.10, bateria_baixa: -0.18,
                primeira_visita: -0.25, retorno: 0.60,
                horario_pico: 0.38, horario_comercial: 0.18, dia_util: 0.22,
                google_ads: 0.55, organico: 0.25, direct: -0.05, fbclid: 0.25, tem_gclid: 0.50,
                tem_utm_campaign: 0.30, tem_utm_term: 0.28,
                proxy_vpn: -0.80, datacenter_ip: -1.00,
            }
        }
    },
    versao: 'v2.0-fallback',
    precisao: 65,
    dataAtualizacao: '2026-04-21'
};

/**
 * Carrega pesos do Sheets (aba "Modelo Ativo").
 * Usa cache de 15 min para não chamar Sheets em toda requisição.
 * Se falhar, usa MODELO_FALLBACK silenciosamente.
 */
async function carregarModelo() {
    const agora = Date.now();

    // Retorna cache se ainda válido
    if (_modeloCache && (agora - _modeloCacheTime) < CACHE_TTL_MS) {
        return _modeloCache;
    }

    try {
        const sheets = await getSheets();
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Modelo Ativo!A:E'
            // Formato da aba:
            // Linha 1: header  → versao | precisao | dataAtualizacao | bias_global | (vazio)
            // Linha 2: metadata → v2.1   | 82        | 2026-05-04      | -1.2        |
            // Linha 3: header  → site | feature | peso | bias_site | (vazio)
            // Linha 4+: dados  → Blog | tempo_ativo_segundos | 0.025 | | 
            //                    Blog | scroll_max_pct       | 0.018 | |
            //                    ...
            //                    Blog | __bias__             |       | -1.5 |  ← bias do site
        });

        const rows = res.data.values || [];
        if (rows.length < 4) {
            // Aba existe mas vazia — usa fallback
            console.log('Modelo Ativo vazia, usando fallback');
            _modeloCache = MODELO_FALLBACK;
            _modeloCacheTime = agora;
            return _modeloCache;
        }

        // Parse linha 2 (metadata)
        const meta    = rows[1] || [];
        const versao  = meta[0] || 'v2.0';
        const precisao = parseFloat(meta[1]) || 65;
        const dataAtual = meta[2] || '-';
        const biasGlobal = parseFloat(meta[3]) || -1.2;

        // Parse linhas 4+ (pesos por site/feature)
        const sites = {};
        for (let i = 3; i < rows.length; i++) {
            const [site, feature, peso, biasSite] = rows[i];
            if (!site || !feature) continue;

            if (!sites[site]) {
                sites[site] = { bias: -1.0, weights: {} };
            }

            if (feature === '__bias__') {
                // Linha especial que guarda o bias do site
                sites[site].bias = parseFloat(biasSite) || -1.0;
            } else {
                sites[site].weights[feature] = parseFloat(peso) || 0;
            }
        }

        // Se não tem dados suficientes, usa fallback
        if (Object.keys(sites).length === 0) {
            _modeloCache = MODELO_FALLBACK;
            _modeloCacheTime = agora;
            return _modeloCache;
        }

        // Mescla com fallback para sites faltantes
        const sitesMesclados = { ...MODELO_FALLBACK.sites };
        for (const [site, modelo] of Object.entries(sites)) {
            sitesMesclados[site] = modelo;
        }

        _modeloCache = {
            bias_global:     biasGlobal,
            sites:           sitesMesclados,
            versao,
            precisao,
            dataAtualizacao: dataAtual
        };
        _modeloCacheTime = agora;

        console.log(`Modelo carregado do Sheets: ${versao} | precisao: ${precisao}% | ${dataAtual}`);
        return _modeloCache;

    } catch (err) {
        console.error('Erro ao carregar modelo do Sheets:', err.message);
        // Falha silenciosa — usa fallback
        _modeloCache = MODELO_FALLBACK;
        _modeloCacheTime = agora;
        return _modeloCache;
    }
}

// ============================================================
// ===== MOTOR ML =====
// ============================================================

function resolverSiteKey(siteName, modelo) {
    const tab = SITE_TABS[siteName] || siteName || 'Site Principal';
    return modelo.sites[tab] ? tab : 'Site Principal';
}

function extrairFeatures(data, geo) {
    // Parse seções — formato: "tratamentos: 44s, qualificacoes: 24s"
    const sections = {};
    try {
        const sv = String(data.sections_viewed || '');
        if (sv.length > 2 && sv.includes(':')) {
            sv.split(',').forEach(item => {
                const colonIdx = item.indexOf(':');
                if (colonIdx > 0) sections[item.substring(0, colonIdx).trim().toLowerCase()] = 1;
            });
        } else {
            const parsed = JSON.parse(sv || '{}');
            Object.keys(parsed).forEach(k => { sections[k.toLowerCase()] = 1; });
        }
    } catch(e) {}

    const hora      = new Date().getHours();
    const dia       = new Date().getDay();
    const cidade    = String(geo.city || '').toLowerCase();
    const estado    = String(geo.region || '').toLowerCase();
    const fonte     = identifyTrafficSource(data).toLowerCase();
    const dispositivo = String(data.device_type || '').toLowerCase();
    const sistema   = String(data.os || '').toLowerCase();
    const conexao   = String(data.connection_type || '').toLowerCase();
    const botao     = String(data.whatsapp_button || '').toLowerCase();
    const bateria   = parseFloat(data.battery_level) || 1.0;
    const regiao    = ['sarandi','paicandu','mandaguari','marialva','astorga','iguaracu'];

    const temChave = (palavras) =>
        palavras.some(p => Object.keys(sections).some(k => k.includes(p)));

    return {
        tempo_ativo_segundos: Math.min(Number(data.active_time)  || 0, 600),
        scroll_max_pct:       Math.min(Number(data.scroll_max)   || 0, 100),
        total_cliques:        Math.min(Number(data.click_count)  || 0, 50),
        tab_switches:         Math.min(Number(data.tab_switches) || 0, 10),

        viu_tratamentos:   temChave(['tratamentos','tratamento','procedimentos']) ? 1 : 0,
        viu_reviews:       temChave(['reviews','avaliacoes','avalia','depoimentos','pacientes']) ? 1 : 0,
        viu_qualificacoes: temChave(['qualificacoes','qualifica','formacao','sobre']) ? 1 : 0,
        viu_convenios:     temChave(['convenios','convenio','conv','planos']) ? 1 : 0,
        viu_localizacao:   temChave(['localizacao','localiza','endereco','mapa','whatsapp']) ? 1 : 0,

        clicou_maps:  data.clicked_maps  ? 1 : 0,
        clicou_blog:  data.clicked_blog  ? 1 : 0,
        clicou_phone: data.clicked_phone ? 1 : 0,

        botao_principal: botao.includes('principal') || botao.includes('main') ? 1 : 0,
        botao_flutuante: botao.includes('flutuante') || botao.includes('float') || botao.includes('fixo') ? 1 : 0,
        botao_header:    botao.includes('header') || botao.includes('topo') ? 1 : 0,

        cidade_maringa: cidade.includes('maringá') || cidade.includes('maringa') ? 1 : 0,
        cidade_regiao:  regiao.some(c => cidade.includes(c)) ? 1 : 0,
        estado_parana:  estado.includes('paraná') || estado.includes('parana') ? 1 : 0,

        mobile:        dispositivo === 'mobile' ? 1 : 0,
        ios:           sistema.includes('ios') || sistema.includes('iphone') ? 1 : 0,
        touch:         data.is_touch ? 1 : 0,
        conexao_wifi:  conexao.includes('wifi') || conexao.includes('wi-fi') || conexao.includes('4g') ? 1 : 0,
        bateria_baixa: bateria < 0.20 ? 1 : 0,

        primeira_visita: data.first_visit === true || data.first_visit === 'true' ? 1 : 0,
        retorno:         data.first_visit === false || data.first_visit === 'false' ? 1 : 0,

        horario_pico:      [10,11,14,15,16].includes(hora) ? 1 : 0,
        horario_comercial: hora >= 8 && hora <= 18 ? 1 : 0,
        dia_util:          dia >= 1 && dia <= 5 ? 1 : 0,

        google_ads:       fonte.includes('google ads') ? 1 : 0,
        organico:         fonte.includes('orgânico') || fonte.includes('organico') ? 1 : 0,
        direct:           fonte.includes('direto') || fonte.includes('direct') ? 1 : 0,
        fbclid:           String(data.fbclid || '').length > 5 ? 1 : 0,
        tem_gclid:        String(data.gclid   || '').length > 5 ? 1 : 0,
        tem_utm_campaign: data.utm_campaign && data.utm_campaign !== '-' ? 1 : 0,
        tem_utm_term:     data.utm_term     && data.utm_term     !== '-' ? 1 : 0,

        proxy_vpn:     geo.is_proxy   ? 1 : 0,
        datacenter_ip: geo.is_hosting ? 1 : 0,
    };
}

const TRADUCOES = {
    tempo_ativo_segundos: 'tempo na pagina', scroll_max_pct: 'rolagem completa',
    total_cliques: 'muito engajado', tab_switches: 'trocou de aba',
    viu_tratamentos: 'viu tratamentos', viu_reviews: 'leu avaliacoes',
    viu_qualificacoes: 'viu qualificacoes', viu_convenios: 'viu convenios',
    viu_localizacao: 'viu localizacao', clicou_maps: 'clicou no mapa',
    clicou_blog: 'explorou blog', clicou_phone: 'tentou ligar',
    botao_principal: 'botao principal', botao_flutuante: 'botao flutuante', botao_header: 'botao topo',
    cidade_maringa: 'e de Maringa', cidade_regiao: 'e da regiao', estado_parana: 'e do Parana',
    mobile: 'mobile', ios: 'iPhone/iPad', touch: 'touch screen',
    conexao_wifi: 'conexao boa', bateria_baixa: 'bateria baixa',
    primeira_visita: 'primeira visita', retorno: 'visita de retorno',
    horario_pico: 'horario de pico', horario_comercial: 'horario comercial', dia_util: 'dia util',
    google_ads: 'Google Ads', organico: 'organico', direct: 'acesso direto',
    fbclid: 'Meta Ads', tem_gclid: 'Google Ads confirmado',
    tem_utm_campaign: 'campanha rastreada', tem_utm_term: 'keyword rastreada',
    proxy_vpn: 'VPN detectada', datacenter_ip: 'IP datacenter',
};

async function calcularScoreML(data, geo, siteName) {
    try {
        // Carrega modelo do Sheets (automático, cache 15 min)
        const modelo = await carregarModelo();

        const siteKey  = resolverSiteKey(siteName, modelo);
        const siteModelo = modelo.sites[siteKey];
        const features = extrairFeatures(data, geo);

        let z = modelo.bias_global + siteModelo.bias;
        const contribuicoes = [];

        for (const [nome, valor] of Object.entries(features)) {
            const peso    = siteModelo.weights[nome] || 0;
            const contrib = valor * peso;
            z += contrib;
            if (Math.abs(contrib) > 0.04) {
                contribuicoes.push({ feature: nome, contribuicao: contrib });
            }
        }

        const score = Math.round((1 / (1 + Math.exp(-z))) * 100);

        let categoria, urgencia, cor;
        if (score >= 70)      { categoria = 'QUENTE'; urgencia = 'RESPONDER EM MENOS DE 2 MINUTOS'; cor = '#dc2626'; }
        else if (score >= 40) { categoria = 'MORNO';  urgencia = 'Responder em menos de 15 minutos'; cor = '#d97706'; }
        else                  { categoria = 'FRIO';   urgencia = 'Resposta padrao';                   cor = '#0284c7'; }

        contribuicoes.sort((a, b) => Math.abs(b.contribuicao) - Math.abs(a.contribuicao));
        const topRazoes = contribuicoes.slice(0, 3).map(c => TRADUCOES[c.feature] || c.feature);

        return {
            score, categoria, urgencia, cor, topRazoes,
            modelo:   modelo.versao,
            precisao: modelo.precisao,
            site:     siteKey,
            dataModelo: modelo.dataAtualizacao
        };

    } catch(err) {
        console.error('ML error:', err.message);
        return { score: 50, categoria: 'ERRO', urgencia: 'Verificar manualmente', cor: '#666', topRazoes: ['erro'], modelo: 'erro', precisao: 0 };
    }
}

// ============================================================
// ===== GRAVAR NO SHEETS (igual ao original) =====
// ============================================================

async function writeToSheets(data, geo, ip) {
    try {
        const sheets = await getSheets();
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const tabName = SITE_TABS[data.site_name] || 'Outros';

        const dataBR = new Date().toLocaleString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const trafficSource = identifyTrafficSource(data);

        let sectionsStr = '-';
        try {
            const sections = JSON.parse(data.sections_viewed || '{}');
            sectionsStr = Object.entries(sections)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k}: ${v}s`)
                .join(', ') || '-';
        } catch(e) {}

        let timelineStr = '-';
        try {
            const timeline = JSON.parse(data.events_timeline || '[]');
            timelineStr = timeline
                .map(e => `${e.t}s:${e.type}${e.detail ? '(' + e.detail + ')' : ''}`)
                .join(' → ') || '-';
        } catch(e) {}

        const row = [
            dataBR, data.site_name || '-', data.session_id || '-', data.event_type || '-',
            data.total_time || 0, data.active_time || 0,
            trafficSource, data.referrer || '-',
            data.utm_source || '-', data.utm_medium || '-', data.utm_campaign || '-',
            data.utm_term || '-', data.utm_content || '-', data.gclid || '-', data.fbclid || '-',
            data.device_type || '-', data.os || '-', data.browser || '-',
            data.screen_res || '-', data.viewport || '-', data.orientation || '-',
            data.is_touch ? 'Sim' : 'Não', data.cpu_cores || '-',
            data.ram_gb !== '-' ? data.ram_gb + ' GB' : '-',
            data.language || '-', data.timezone || '-',
            data.connection_type || '-', data.downlink_speed || '-',
            data.save_data ? 'Sim' : 'Não', data.battery_level || '-', data.battery_charging || '-',
            ip || '-', geo.city || '-', geo.region || '-', geo.country || '-',
            geo.isp || '-', geo.org || '-',
            geo.is_mobile ? 'Sim' : 'Não', geo.is_proxy ? 'Sim' : 'Não', geo.is_hosting ? 'Sim' : 'Não',
            (geo.lat && geo.lon && geo.lat !== '-') ? `${geo.lat}, ${geo.lon}` : '-',
            data.scroll_max || 0, data.click_count || 0,
            data.first_visit ? 'Primeira visita' : 'Retorno', data.tab_switches || 0,
            data.whatsapp_clicked ? 'Sim' : 'Não', data.whatsapp_button || '-',
            data.clicked_maps ? 'Sim' : 'Não', data.clicked_blog ? 'Sim' : 'Não', data.clicked_phone ? 'Sim' : 'Não',
            sectionsStr, timelineStr
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${tabName}!A:AZ`,
            valueInputOption: 'USER_ENTERED',
            resource: { values: [row] }
        });

        return true;
    } catch (err) {
        console.error('Sheets error:', err.message);
        return false;
    }
}

// ===== GEOLOCALIZAÇÃO =====
async function getGeoData(ip, headers) {
    const vercelCity    = headers['x-vercel-ip-city'] || '';
    const vercelRegion  = headers['x-vercel-ip-country-region'] || '';
    const vercelCountry = headers['x-vercel-ip-country'] || '';
    const vercelLat     = headers['x-vercel-ip-latitude'] || '';
    const vercelLon     = headers['x-vercel-ip-longitude'] || '';

    const brStates = {
        'AC':'Acre','AL':'Alagoas','AP':'Amapá','AM':'Amazonas','BA':'Bahia',
        'CE':'Ceará','DF':'Distrito Federal','ES':'Espírito Santo','GO':'Goiás',
        'MA':'Maranhão','MT':'Mato Grosso','MS':'Mato Grosso do Sul','MG':'Minas Gerais',
        'PA':'Pará','PB':'Paraíba','PR':'Paraná','PE':'Pernambuco','PI':'Piauí',
        'RJ':'Rio de Janeiro','RN':'Rio Grande do Norte','RS':'Rio Grande do Sul',
        'RO':'Rondônia','RR':'Roraima','SC':'Santa Catarina','SP':'São Paulo',
        'SE':'Sergipe','TO':'Tocantins'
    };
    const countries = {
        'BR':'Brasil','US':'Estados Unidos','AR':'Argentina','PT':'Portugal',
        'PY':'Paraguai','UY':'Uruguai','CL':'Chile','CO':'Colômbia','MX':'México'
    };

    let geo = {
        city: decodeURIComponent(vercelCity) || '-',
        region: brStates[vercelRegion] || vercelRegion || '-',
        country: countries[vercelCountry] || vercelCountry || '-',
        lat: vercelLat || '-', lon: vercelLon || '-',
        isp: '-', org: '-', is_mobile: false, is_proxy: false, is_hosting: false
    };

    try {
        if (ip && !['127.0.0.1','::1'].includes(ip) && !ip.startsWith('192.168.') && !ip.startsWith('10.')) {
            const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country,isp,org,as,mobile,proxy,hosting,status&lang=pt-BR`);
            const api = await res.json();
            if (api.status === 'success') {
                if (geo.city === '-') geo.city = api.city || '-';
                if (geo.region === '-') geo.region = api.regionName || '-';
                if (geo.country === '-') geo.country = api.country || '-';
                geo.isp = api.isp || '-';
                geo.org = api.org || '-';
                geo.is_mobile = api.mobile || false;
                geo.is_proxy = api.proxy || false;
                geo.is_hosting = api.hosting || false;
            }
        }
    } catch(e) {}

    return geo;
}

// ===== FONTE DE TRÁFEGO =====
function identifyTrafficSource(data) {
    if (data.gclid) return 'Google Ads';
    if (data.fbclid) return 'Facebook Ads';
    if (data.utm_source) {
        const src = data.utm_source.toLowerCase();
        if (src.includes('google')) return data.utm_medium === 'cpc' ? 'Google Ads' : 'Google Orgânico';
        if (src.includes('facebook') || src.includes('fb')) return 'Facebook';
        if (src.includes('instagram') || src.includes('ig')) return 'Instagram';
        return data.utm_source;
    }
    const ref = (data.referrer || '').toLowerCase();
    if (!ref || ref === 'acesso direto') return 'Acesso Direto';
    if (ref.includes('google')) return 'Google Orgânico';
    if (ref.includes('facebook')) return 'Facebook';
    if (ref.includes('instagram')) return 'Instagram';
    return 'Referral';
}

// ============================================================
// ===== EMAIL HTML — CORREÇÃO DO LINK GOOGLE FORMS =====
// ============================================================

function row(label, value, color) {
    return `<tr><td style="padding:4px 0;width:140px;color:${color||'#666'};font-size:13px;">${label}</td><td style="padding:4px 0;font-size:13px;"><strong>${value||'-'}</strong></td></tr>`;
}
function sectionHeader(title) {
    return `<h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:22px 0 10px;">${title}</h3><table style="width:100%;color:#333;border-collapse:collapse;">`;
}

function buildEmailHTML(data, geo, ip, userAgent, ml) {
    const trafficSource = identifyTrafficSource(data);
    const dataBR = new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // ═══════════════════════════════════════════════════════════════
    // CORREÇÃO: URL COMPLETA + DOUBLE ENCODING
    // ═══════════════════════════════════════════════════════════════
    
    // Encode duas vezes para sobreviver à decodificação do Gmail
    const sessionSafe = encodeURIComponent(encodeURIComponent(data.session_id || ''));
    
    // URL COMPLETA do Google Forms ✅ CONFIGURADO
    const formLink = `https://docs.google.com/forms/d/e/1FAIpQLSdVc-mhz-rjRHKNhuhMUUDr9WRcf9dGqfa5o7qpgKt_O73qWQ/viewform?usp=pp_url&entry.1112604337=${sessionSafe}`;
    
    // ═══════════════════════════════════════════════════════════════

    const corFundo  = ml.score >= 70 ? '#fff5f5' : ml.score >= 40 ? '#fffbeb' : '#f0f9ff';

    const alerts = [];
    if (geo.is_proxy)   alerts.push('VPN/Proxy detectado');
    if (geo.is_hosting) alerts.push('IP de datacenter');
    if (data.save_data) alerts.push('Modo economia de dados');
    if (data.battery_level && data.battery_level !== '-' && parseInt(data.battery_level) <= 20)
        alerts.push('Bateria baixa (' + data.battery_level + ')');

    let timelineHTML = '';
    try {
        const timeline = JSON.parse(data.events_timeline || '[]');
        if (timeline.length > 0) {
            timelineHTML = `
            ${sectionHeader('Jornada do Visitante')}</table>
            <div style="background:#f8fafc;padding:12px 16px;border-radius:8px;font-size:12px;font-family:monospace;color:#334155;line-height:1.8;">
                ${timeline.map(e => `<span style="color:#94a3b8;">${e.t}s</span> → <strong>${e.type}</strong>${e.detail ? ' (' + e.detail + ')' : ''}`).join('<br>')}
            </div>`;
        }
    } catch(e) {}

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,Helvetica,sans-serif;background:#f0f4f8;padding:16px;margin:0;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);max-width:600px;">

  <tr><td style="background:#25d366;padding:18px 24px;">
    <p style="margin:0;font-size:18px;font-weight:700;color:#fff;">Novo Lead WhatsApp</p>
    <p style="margin:5px 0 0;font-size:12px;color:#d4f5e0;">${data.site_name || '-'} | ${dataBR}</p>
    <p style="margin-top:5px;font-size:11px;color:#d4f5e0">GA4 · Google Search Console · Microsoft Clarity · Tracker ML</p>
  </td></tr>

  <tr><td style="padding:20px 24px 0;">

        <table width="100%" cellpadding="0" cellspacing="0" style="background:${corFundo};border:2px solid ${ml.cor};border-radius:12px;margin-bottom:16px;">
      <tr><td style="padding:18px;text-align:center;">
        <p style="margin:0;font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;">
          Score ML | ${ml.modelo} | Precisao ${ml.precisao}% | Atualizado ${ml.dataModelo}
        </p>
        <p style="margin:6px 0 0;font-size:60px;font-weight:900;color:${ml.cor};line-height:1;">${ml.score}%</p>
        <p style="margin:6px 0 0;font-size:15px;font-weight:700;color:${ml.cor};">[${ml.categoria}] - ${ml.site}</p>
        <p style="margin:8px 0 0;font-size:11px;color:#555;">${ml.topRazoes.join(' | ')}</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
          <tr><td style="background:${ml.cor};border-radius:6px;padding:10px;text-align:center;">
            <p style="margin:0;font-size:13px;font-weight:700;color:#fff;">${ml.urgencia}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>

        <div style="background:#f0fdf4;border-left:4px solid #25d366;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;">
      <div style="font-size:13px;color:#333;line-height:1.8;">
        🆔 <strong>ID da Sessão:</strong> ${data.session_id || '-'}<br>
        📄 <strong>Página:</strong> ${data.page_url || '-'}<br>
        🔘 <strong>Botão:</strong> ${data.whatsapp_button || '-'}
      </div>
    </div>

    ${alerts.length > 0 ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin:10px 0;font-size:13px;color:#991b1b;">${alerts.join(' | ')}</div>` : ''}

    ${sectionHeader('Dispositivo')}
      ${row('Tipo', data.device_type)}${row('Sistema', data.os)}${row('Navegador', data.browser)}
      ${row('Tela', data.screen_res)}${row('Viewport', data.viewport)}${row('Orientacao', data.orientation)}
      ${row('Touch', data.is_touch ? 'Sim' : 'Nao')}${row('CPU Cores', data.cpu_cores)}
      ${row('RAM', data.ram_gb !== '-' ? data.ram_gb + ' GB' : '-')}
      ${row('Idioma', data.language)}${row('Fuso', data.timezone)}
    </table>

    ${sectionHeader('Conexao e Bateria')}
      ${row('Conexao', data.connection_type)}${row('Velocidade', data.downlink_speed)}
      ${row('Economia Dados', data.save_data ? 'Sim' : 'Nao')}
      ${row('Bateria', data.battery_level)}${row('Carregando', data.battery_charging)}
      ${row('Rede Movel', geo.is_mobile ? 'Sim' : 'Nao')}
    </table>

    ${sectionHeader('Localizacao')}
      ${row('Cidade', geo.city)}${row('Estado', geo.region)}${row('Pais', geo.country)}
      ${row('ISP', geo.isp)}${row('Organizacao', geo.org)}${row('IP', ip)}
      ${row('VPN/Proxy', geo.is_proxy ? 'Sim' : 'Nao')}${row('IP Datacenter', geo.is_hosting ? 'Sim' : 'Nao')}
    </table>
    ${(geo.lat !== '-' && geo.lon !== '-') ? `<div style="margin:6px 0;"><a href="https://www.google.com/maps?q=${geo.lat},${geo.lon}" style="font-size:12px;color:#1e3a8a;font-weight:600;">Ver no Google Maps</a></div>` : ''}

    ${sectionHeader('Origem do Trafego')}
      ${row('Fonte', trafficSource, '#1e3a8a')}${row('Referrer', data.referrer || 'Acesso direto')}
      ${data.gclid ? row('GCLID', data.gclid) : ''}${data.fbclid ? row('FBCLID', data.fbclid) : ''}
    </table>

    ${(data.utm_source || data.utm_campaign || data.utm_term) ? `
    ${sectionHeader('Parametros UTM')}</table>
    <div style="background:#f8fafc;padding:12px 16px;border-radius:8px;font-size:12px;font-family:monospace;color:#334155;line-height:1.8;">
      ${data.utm_source   ? `utm_source: <strong>${data.utm_source}</strong><br>` : ''}
      ${data.utm_medium   ? `utm_medium: <strong>${data.utm_medium}</strong><br>` : ''}
      ${data.utm_campaign ? `utm_campaign: <strong>${data.utm_campaign}</strong><br>` : ''}
      ${data.utm_term     ? `utm_term: <strong>${data.utm_term}</strong><br>` : ''}
      ${data.utm_content  ? `utm_content: <strong>${data.utm_content}</strong>` : ''}
    </div>` : ''}

    ${sectionHeader('Comportamento')}
      ${row('ID da Sessão', data.session_id)}
      ${row('Tempo Total', (data.total_time || 0) + 's')}
      ${row('Tempo Ativo', (data.active_time || 0) + 's')}
      ${row('Rolagem Maxima', (data.scroll_max || 0) + '%')}
      ${row('Cliques', (data.click_count || 0) + ' interacoes')}
      ${row('Tipo Visita', data.first_visit ? 'Primeira visita' : 'Retorno')}
      ${row('Trocas de Aba', data.tab_switches || 0)}
    </table>

    ${timelineHTML}

        <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border:2px solid #fbbf24;border-radius:10px;margin-top:20px;">
      <tr><td style="padding:16px;text-align:center;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#92400e;">ANA PAULA: Registre o resultado apos atender</p>
        <p style="margin:0 0 12px;font-size:11px;color:#78350f;">Leva 30 segundos e melhora o sistema!</p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr><td style="background:#f59e0b;border-radius:8px;padding:10px 24px;">
            <a href="${formLink}" target="_blank" rel="noopener noreferrer" style="color:#fff;font-size:13px;font-weight:700;text-decoration:none;display:block;">Preencher Feedback</a>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <div style="margin-top:16px;padding:10px 14px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
      <div style="font-size:10px;color:#94a3b8;margin-bottom:4px;">USER AGENT</div>
      <div style="font-size:10px;color:#64748b;word-break:break-all;font-family:monospace;">${userAgent || '-'}</div>
    </div>

  </td></tr>

  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 24px;text-align:center;">
    <p style="margin:0;font-size:10px;color:#94a3b8;">Maringa Vasculares - tracker v5 | ML auto-atualizado via Sheets</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

// ===== HANDLER PRINCIPAL =====
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const ip        = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '-';

    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

    try {
        const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const geo  = await getGeoData(ip, req.headers);

        // 1. Sempre grava no Sheets (idêntico ao original)
        const sheetsOk = await writeToSheets(data, geo, ip);

        // 2. Se clicou WhatsApp → calcula ML (pesos do Sheets) + envia email
        let emailOk = true;
        if (data.send_email && data.event_type === 'whatsapp_click') {
            try {
                // Carrega modelo atualizado do Sheets (cache 15 min, automático)
                const ml = await calcularScoreML(data, geo, data.site_name);

                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
                });

                await transporter.sendMail({
                    from:    `"Maringa Vasculares - Sistema ML" <${process.env.GMAIL_USER}>`,
                    to:      'msvasculares@gmail.com',
                    cc:      'mauriciohy@gmail.com',
                    subject: `[${ml.categoria}] Lead ${ml.score}% - ${data.site_name || 'Site'}`,
                    html:    buildEmailHTML(data, geo, ip, userAgent, ml)
                });

            } catch(e) {
                console.error('Email/ML error:', e.message);
                emailOk = false;
            }
        }

        return res.status(200).json({ ok: true, sheets: sheetsOk, email: emailOk });

    } catch (err) {
        console.error('Tracker error:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
};
