import { useState, useEffect } from 'react';

interface NewsItem {
  title: string;
  description: string;
  url: string;
  urlToImage: string;
  sourceName: string;
  publishedAt: string;
}

interface WeatherDetails {
  city: string;
  temp: string;
  condition: string;
  icon: string;
  minTemp: string;
  maxTemp: string;
}

const C = {
  dark: '#0f172a',
  dark2: '#1e293b',
  blue: '#2563eb',
  bg: '#f1f5f9',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
  muted2: '#94a3b8',
};

const API_BASE = '/api';

const App = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [time, setTime] = useState('');
  const [width, setWidth] = useState(1200);
  const [weather, setWeather] = useState<WeatherDetails>({ city: 'São Paulo', temp: '--°', condition: 'Carregando...', icon: '⏳', minTemp: '--', maxTemp: '--' });
  const [news, setNews] = useState<NewsItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('sports');
  const [loadingNews, setLoadingNews] = useState(true);

  const iconEmoji = (i: string) => ({
    Clear: '☀️', PartlyCloudy: '⛅', Clouds: '☁️', Fog: '🌫️',
    Drizzle: '🌦️', Rain: '🌧️', Showers: '🌧️', Snow: '❄️', Storm: '⛈️',
  } as Record<string, string>)[i] || '🌡️';

  useEffect(() => {
    const fmt = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setTime(fmt());
    const timer = setInterval(() => setTime(fmt()), 1000);
    
    const onResize = () => setWidth(window.innerWidth);
    setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);

    // Initial Fetch
    fetchWeather();
    fetchNews(activeCategory);

    return () => { clearInterval(timer); window.removeEventListener('resize', onResize); };
  }, []);

  useEffect(() => {
    fetchNews(activeCategory);
  }, [activeCategory]);

  const fetchWeather = async () => {
    try {
      const res = await fetch(`${API_BASE}/weather/current`);
      const data = await res.json();
      setWeather(data);
    } catch (e) {
      console.error("Erro ao buscar clima:", e);
    }
  };

  const fetchNews = async (category: string) => {
    setLoadingNews(true);
    try {
      const res = await fetch(`${API_BASE}/news/headlines?category=${category}`);
      const data = await res.json();
      setNews(data);
    } catch (e) {
      console.error("Erro ao buscar notícias:", e);
    } finally {
      setLoadingNews(false);
    }
  };

  const isDesktop = width >= 768;

  const sections = [
    { id: 'home', label: 'Início' },
    { id: 'news', label: 'Notícias' },
    { id: 'weather', label: 'Clima' },
    { id: 'settings', label: 'Configurações' },
  ];

  const categories = [
    { id: 'sports', label: 'Futebol' },
    { id: 'politics', label: 'Política' },
    { id: 'games', label: 'Games' },
    { id: 'technology', label: 'Tecnologia' },
    { id: 'innovation', label: 'Inovação' },
  ];

  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: '100vh', margin: 0 }}>

      {/* HEADER */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 60, zIndex: 120,
        backgroundColor: C.dark, display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '0 16px', boxSizing: 'border-box',
        borderBottom: '1px solid #1e293b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <button onClick={() => setIsMenuOpen(true)} aria-label="Abrir menu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, display: 'flex', alignItems: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e2e8f0" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: C.blue, flexShrink: 0 }} />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', letterSpacing: '.5px', whiteSpace: 'nowrap' }}>Portal Central</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', backgroundColor: C.dark2, borderRadius: 8, border: '1px solid #334155', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 14 }}>{iconEmoji(weather.icon)}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{weather.temp}</span>
            {isDesktop && <span style={{ fontSize: 12, color: C.muted2 }}>{weather.condition}</span>}
          </div>
          <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, color: '#93c5fd', fontWeight: 600, whiteSpace: 'nowrap', padding: '5px 10px', backgroundColor: C.dark2, borderRadius: 8, border: '1px solid #334155' }}>
            {time}
          </div>
        </div>
      </header>

      {/* DRAWER */}
      {isMenuOpen && (
        <div onClick={() => setIsMenuOpen(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,.55)', zIndex: 130 }} />
      )}
      <div style={{
        position: 'fixed', top: 0, left: 0, height: '100%', width: 'min(280px, 85vw)',
        backgroundColor: C.dark, zIndex: 140,
        transform: isMenuOpen ? 'translateX(0)' : 'translateX(-105%)',
        transition: 'transform .25s ease', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #1e293b' }}>
          <span style={{ color: '#f8fafc', fontWeight: 700, fontSize: 15 }}>Navegação</span>
          <button onClick={() => setIsMenuOpen(false)} aria-label="Fechar menu" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 12 }}>
          {sections.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setIsMenuOpen(false)}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = C.dark2; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#cbd5e1'; }}
              style={{ display: 'block', padding: '12px 16px', borderRadius: 8, color: '#cbd5e1', textDecoration: 'none', fontSize: 14, fontWeight: 500, transition: 'background .15s, color .15s' }}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <div style={{ marginTop: 'auto', padding: 16, borderTop: '1px solid #1e293b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', backgroundColor: C.blue, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>AD</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>admin</div>
              <div style={{ fontSize: 11, color: C.muted2 }}>Administrador</div>
            </div>
          </div>
        </div>
      </div>

      {/* MAIN */}
      <main style={{ paddingTop: 60, maxWidth: 1120, margin: '0 auto', padding: '24px 16px 64px', boxSizing: 'border-box', width: '100%' }}>

        {/* HERO */}
        <section id="home" style={{
          borderRadius: 16, overflow: 'hidden', padding: isDesktop ? '64px 48px' : '40px 24px',
          background: `linear-gradient(135deg, ${C.dark} 0%, #1e3a8a 100%)`,
          color: '#fff', textAlign: 'center',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#93c5fd' }}>
            Portal de informações em tempo real
          </span>
          <h1 style={{ fontSize: 'clamp(26px, 5vw, 42px)', fontWeight: 800, margin: '16px 0 12px', lineHeight: 1.15, letterSpacing: '-.5px' }}>
            Notícias, clima e análise em um só lugar
          </h1>
          <p style={{ color: '#cbd5e1', maxWidth: 560, margin: '0 auto 28px', fontSize: 15, lineHeight: 1.6 }}>
            Acompanhe as principais manchetes do Brasil organizadas por área, com previsão do tempo e atualização contínua.
          </p>
          <a href="#news" style={{ display: 'inline-block', padding: '12px 28px', borderRadius: 10, backgroundColor: C.blue, color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
            Ver últimas notícias
          </a>
        </section>

        {/* NEWS */}
        <section id="news" style={{ paddingTop: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ width: 4, height: 24, backgroundColor: C.blue, borderRadius: 2 }} />
            <h2 style={{ fontSize: isDesktop ? 24 : 20, fontWeight: 700, margin: 0 }}>Últimas notícias</h2>
          </div>

          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12, marginBottom: 20 }}>
            {categories.map(cat => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    padding: '8px 18px', borderRadius: 999, flexShrink: 0, cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, transition: 'all .15s',
                    border: `1px solid ${active ? C.blue : C.border}`,
                    backgroundColor: active ? C.blue : '#fff',
                    color: active ? '#fff' : C.muted,
                  }}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {loadingNews ? (
            <div style={{ textAlign: 'center', padding: '40px', color: C.muted }}>Carregando notícias...</div>
          ) : news.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '2fr 1fr' : '1fr', gap: 24, alignItems: 'start' }}>
              {/* Featured */}
              <article style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,.08)' }}>
                <div style={{ position: 'relative', height: isDesktop ? 300 : 190, backgroundColor: C.dark2 }}>
                  <img src={news[0].urlToImage || 'https://picsum.photos/900/500'} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <span style={{ position: 'absolute', top: 14, left: 14, backgroundColor: C.blue, color: '#fff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', padding: '4px 10px', borderRadius: 6 }}>
                    Destaque
                  </span>
                </div>
                <div style={{ padding: isDesktop ? 24 : 16 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>
                    {new Date(news[0].publishedAt).toLocaleDateString()} · {news[0].sourceName}
                  </div>
                  <h3 style={{ fontSize: isDesktop ? 22 : 18, fontWeight: 700, lineHeight: 1.3, margin: '0 0 10px' }}>{news[0].title}</h3>
                  <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, margin: '0 0 16px' }}>{news[0].description}</p>
                  <a href={news[0].url} target="_blank" rel="noopener noreferrer" style={{ color: C.blue, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Ler matéria completa →</a>
                </div>
              </article>

              {/* List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {news.slice(1).map((item, idx) => (
                  <a
                    key={idx}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', gap: 14, textDecoration: 'none', color: C.text,
                      backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                      padding: 12, boxSizing: 'border-box',
                      boxShadow: '0 1px 3px rgba(15,23,42,.06)', transition: 'box-shadow .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,.06)'; }}
                  >
                    <img src={item.urlToImage || 'https://picsum.photos/100/100'} alt="" style={{ width: 88, height: 88, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: C.muted2 }}>{new Date(item.publishedAt).toLocaleDateString()} · {item.sourceName}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{item.title}</div>
                      {isDesktop && <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{item.description}</div>}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: C.muted }}>Nenhuma notícia encontrada para esta categoria.</div>
          )}
        </section>

        {/* WEATHER */}
        <section id="weather" style={{ paddingTop: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ width: 4, height: 24, backgroundColor: C.blue, borderRadius: 2 }} />
            <h2 style={{ fontSize: isDesktop ? 24 : 20, fontWeight: 700, margin: 0 }}>Previsão do tempo</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            <div style={{
              backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
              padding: isDesktop ? 32 : 24, textAlign: 'center',
              boxShadow: '0 1px 3px rgba(15,23,42,.08)', borderTop: `3px solid ${C.blue}`,
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 12 }}>Hoje · {weather.city || 'São Paulo'}</div>
              <div style={{ fontSize: 44, marginBottom: 8 }}>{iconEmoji(weather.icon)}</div>
              <div style={{ fontSize: isDesktop ? 40 : 34, fontWeight: 800, color: C.text }}>{weather.temp}</div>
              <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>{weather.condition}</div>
              <div style={{ fontSize: 12.5, color: C.muted2, marginTop: 12 }}>Máx {weather.maxTemp} · Mín {weather.minTemp}</div>
            </div>
          </div>
        </section>
      </main>

      <footer style={{ backgroundColor: C.dark, padding: '28px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: C.muted2 }}>© 2026 Portal Central · Sistema operacional · v1.1.0</div>
      </footer>
    </div>
  );
};

export default App;
