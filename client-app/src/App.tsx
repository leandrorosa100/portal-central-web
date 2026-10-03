import { useState, useEffect, type FormEvent } from 'react';
import AdminPanel from './AdminPanel';

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

interface CityItem { id: number; name: string; isPrimary: boolean }
interface PinnedItem { id: number; title: string; url: string; urlToImage: string | null; description: string | null; sourceName: string | null; pinnedAt: string }
interface ArticleItem { id: number; title: string; body: string; category: string; author: string; createdAt: string }

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
  const [cities, setCities] = useState<CityItem[]>([]);
  const [weatherMap, setWeatherMap] = useState<Record<string, WeatherDetails>>({});
  const [pinned, setPinned] = useState<PinnedItem[]>([]);
  const [articles, setArticles] = useState<ArticleItem[]>([]);
  const [showArticleModal, setShowArticleModal] = useState(false);
  const [editingArticle, setEditingArticle] = useState<ArticleItem | null>(null);
  const [articleForm, setArticleForm] = useState({ title: '', category: '', body: '' });
  const [articleMsg, setArticleMsg] = useState('');

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
    fetchCitiesAndWeather();
    fetchPinned();
    fetchArticles();

    // Sessao restaurada sem papel? busca no /me (e sai se o token morreu)
    if (localStorage.getItem('pc_token') && !localStorage.getItem('pc_role')) {
      fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ***` } })
        .then(r => (r.ok ? r.json() : null))
        .then(d => {
          if (d?.role) { setAuthRole(d.role); localStorage.setItem('pc_role', d.role); }
          else if (d === null) { doLogout(); }
        })
        .catch(() => {});
    }

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

  // ---------- Auth ----------
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('pc_token'));
  const [authUser, setAuthUser] = useState<string | null>(() => localStorage.getItem('pc_user'));
  const [authRole, setAuthRole] = useState<string | null>(() => localStorage.getItem('pc_role'));
  const [showLogin, setShowLogin] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);

  const openLogin = () => { setLoginError(''); setLoginForm({ username: '', password: '' }); setShowLogin(true); };

  const doLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (loginBusy) return;
    setLoginBusy(true); setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('pc_token', data.token);
        localStorage.setItem('pc_user', data.username);
        localStorage.setItem('pc_role', data.role || '');
        setToken(data.token); setAuthUser(data.username); setAuthRole(data.role || '');
        setShowLogin(false);
      } else if (res.status === 429) {
        setLoginError('Muitas tentativas. Aguarde um minuto e tente novamente.');
      } else {
        setLoginError('Usuário ou senha inválidos.');
      }
    } catch {
      setLoginError('Falha de conexão. Tente novamente.');
    } finally {
      setLoginBusy(false);
    }
  };

  const doLogout = () => {
    localStorage.removeItem('pc_token'); localStorage.removeItem('pc_user'); localStorage.removeItem('pc_role');
    setToken(null); setAuthUser(null); setAuthRole(null);
  };

  // ---------- Admin API helper ----------
  const authApi = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    if (res.status === 401) { doLogout(); throw new Error('Sessão expirada'); }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as { message?: string })?.message || `Erro ${res.status}`);
    return data;
  };

  const fetchCitiesAndWeather = async () => {
    let list: CityItem[] = [];
    try {
      const res = await fetch(`${API_BASE}/cities`);
      list = await res.json();
      if (!Array.isArray(list) || !list.length) list = [{ id: 0, name: 'São Paulo', isPrimary: true }];
    } catch { list = [{ id: 0, name: 'São Paulo', isPrimary: true }]; }
    setCities(list);
    const map: Record<string, WeatherDetails> = {};
    await Promise.all(list.map(async c => {
      try {
        const r = await fetch(`${API_BASE}/weather/current?city=${encodeURIComponent(c.name)}`);
        const w = await r.json();
        if (w && w.city) map[c.name] = w;
      } catch { /* card mostra placeholder */ }
    }));
    setWeatherMap(map);
  };

  const fetchPinned = async () => {
    try {
      const res = await fetch(`${API_BASE}/news/pinned`);
      const list = await res.json();
      if (Array.isArray(list)) setPinned(list);
    } catch { /* silencioso */ }
  };

  const fetchArticles = async () => {
    try {
      const res = await fetch(`${API_BASE}/articles`);
      const list = await res.json();
      if (Array.isArray(list)) setArticles(list);
    } catch { /* silencioso */ }
  };

  const pinNews = async (item: NewsItem) => {
    try {
      const list = await authApi('/admin/pins', { method: 'POST', body: JSON.stringify({ title: item.title, url: item.url, urlToImage: item.urlToImage, description: item.description, sourceName: item.sourceName }) });
      setPinned(list as PinnedItem[]);
    } catch (e) { console.error(e); }
  };

  const unpinNews = async (id: number) => {
    try {
      const list = await authApi(`/admin/pins/${id}`, { method: 'DELETE' });
      setPinned(list as PinnedItem[]);
    } catch (e) { console.error(e); }
  };

  const openArticleModal = (article: ArticleItem | null) => {
    setEditingArticle(article);
    setArticleForm(article ? { title: article.title, category: article.category, body: article.body } : { title: '', category: '', body: '' });
    setArticleMsg('');
    setShowArticleModal(true);
  };

  const saveArticle = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const list = editingArticle
        ? await authApi(`/admin/articles/${editingArticle.id}`, { method: 'PUT', body: JSON.stringify(articleForm) })
        : await authApi('/admin/articles', { method: 'POST', body: JSON.stringify(articleForm) });
      setArticles(list as ArticleItem[]);
      setShowArticleModal(false);
    } catch (e) { setArticleMsg((e as Error).message); }
  };

  const deleteArticle = async (id: number) => {
    try {
      const list = await authApi(`/admin/articles/${id}`, { method: 'DELETE' });
      setArticles(list as ArticleItem[]);
    } catch (e) { console.error(e); }
  };

  const isAdmin = authRole === 'Admin';

  const sections = [
    { id: 'home', label: 'Início' },
    { id: 'news', label: 'Notícias' },
    { id: 'editoria', label: 'Portal Original' },
    { id: 'weather', label: 'Clima' },
    ...(token && isAdmin ? [{ id: 'admin', label: 'Administração' }] : []),
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
          {token ? (
            <button onClick={() => document.getElementById('settings')?.scrollIntoView({ behavior: 'smooth' })} title={`Sessão: ${authUser}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', backgroundColor: C.dark2, borderRadius: 8, border: '1px solid #334155', cursor: 'pointer' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 10, fontWeight: 700 }}>{(authUser || 'U').slice(0, 2).toUpperCase()}</div>
              {isDesktop && <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{authUser}</span>}
            </button>
          ) : (
            <button onClick={openLogin} style={{ padding: '6px 16px', backgroundColor: C.blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Entrar</button>
          )}
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
          {token ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', backgroundColor: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{(authUser || 'U').slice(0, 2).toUpperCase()}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{authUser}</div>
                  <div style={{ fontSize: 11, color: '#4ade80' }}>● Sessão ativa</div>
                </div>
              </div>
              <button onClick={doLogout} style={{ background: 'none', border: '1px solid #475569', color: '#cbd5e1', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>Sair</button>
            </div>
          ) : (
            <button onClick={() => { setIsMenuOpen(false); openLogin(); }} style={{ width: '100%', padding: '10px 0', backgroundColor: C.blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Entrar</button>
          )}
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
            <>
            {pinned.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px' }}>📌 Destaques da editoria</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {pinned.map(p => (
                    <div key={p.id} style={{ position: 'relative', backgroundColor: C.dark, borderRadius: 10, padding: '12px 14px', paddingRight: token ? 34 : 14, border: '1px solid #334155' }}>
                      <div style={{ fontSize: 10.5, color: C.muted2, marginBottom: 4 }}>{p.sourceName || 'Fixada'}</div>
                      <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', textDecoration: 'none', lineHeight: 1.35, display: 'block' }}>{p.title}</a>
                      {isAdmin && (
                        <button onClick={() => unpinNews(p.id)} title="Desfixar" style={{ position: 'absolute', top: 8, right: 8, background: 'none', border: 'none', color: C.muted2, cursor: 'pointer', fontSize: 12, padding: 2 }}>✕</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Featured */}
              <article style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,.08)' }}>
                <div style={{ position: 'relative', height: isDesktop ? 340 : 200, backgroundColor: C.dark2 }}>
                  <img src={news[0].urlToImage || 'https://picsum.photos/1200/600'} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  <span style={{ position: 'absolute', top: 14, left: 14, backgroundColor: C.blue, color: '#fff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', padding: '4px 10px', borderRadius: 6 }}>
                    Destaque
                  </span>
                  {isAdmin && (
                    <button onClick={() => pinNews(news[0])} title="Fixar esta notícia" style={{ position: 'absolute', top: 10, right: 10, zIndex: 5, background: 'rgba(15,23,42,.65)', border: '1px solid #475569', borderRadius: 8, cursor: 'pointer', fontSize: 15, padding: '4px 8px' }}>📌</button>
                  )}
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

              {/* List — below the featured article, filling the screen width */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
                {news.slice(1).map((item, idx) => (
                  <a
                    key={idx}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex', flexDirection: 'column', textDecoration: 'none', color: C.text,
                      backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                      overflow: 'hidden', boxShadow: '0 1px 3px rgba(15,23,42,.06)', transition: 'box-shadow .15s',
                      position: 'relative',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,.12)'; }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,.06)'; }}
                  >
                    <img src={item.urlToImage || 'https://picsum.photos/640/360'} alt="" style={{ width: '100%', height: 150, objectFit: 'cover', flexShrink: 0, display: 'block' }} />
                    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <div style={{ fontSize: 11, color: C.muted2 }}>{new Date(item.publishedAt).toLocaleDateString()} · {item.sourceName}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{item.title}</div>
                      <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.description}</div>
                    </div>
                    {isAdmin && (
                      <button onClick={ev => { ev.preventDefault(); ev.stopPropagation(); pinNews(item); }} title="Fixar esta notícia" style={{ position: 'absolute', top: 8, right: 8, zIndex: 5, background: 'rgba(255,255,255,.92)', border: `1px solid ${C.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13, padding: '3px 7px', boxShadow: '0 1px 3px rgba(15,23,42,.15)' }}>📌</button>
                    )}
                  </a>
                ))}
              </div>
            </div>
            </>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 }}>
            {cities.map(c => {
              const w = weatherMap[c.name];
              return (
                <div key={c.id} style={{
                  backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
                  padding: isDesktop ? 28 : 20, textAlign: 'center',
                  boxShadow: '0 1px 3px rgba(15,23,42,.08)', borderTop: `3px solid ${c.isPrimary ? C.blue : C.border}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 12 }}>{c.isPrimary ? 'Hoje · ' : ''}{w?.city || c.name}</div>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>{w ? iconEmoji(w.icon) : '⏳'}</div>
                  <div style={{ fontSize: 34, fontWeight: 800, color: C.text }}>{w?.temp || '--°'}</div>
                  <div style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>{w?.condition || 'Carregando...'}</div>
                  <div style={{ fontSize: 12.5, color: C.muted2, marginTop: 12 }}>Máx {w?.maxTemp || '--'} · Mín {w?.minTemp || '--'}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* EDITORIA */}
        <section id="editoria" style={{ paddingTop: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 4, height: 24, backgroundColor: C.blue, borderRadius: 2 }} />
              <h2 style={{ fontSize: isDesktop ? 24 : 20, fontWeight: 700, margin: 0 }}>Portal Original</h2>
            </div>
            {isAdmin && (
              <button onClick={() => openArticleModal(null)} style={{ padding: '9px 18px', backgroundColor: C.blue, border: 'none', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>+ Nova matéria</button>
            )}
          </div>
          {articles.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {articles.map(a => (
                <div key={a.id} style={{ position: 'relative', backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(15,23,42,.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1px', backgroundColor: '#eff6ff', padding: '3px 8px', borderRadius: 6 }}>{a.category}</span>
                    <span style={{ fontSize: 11, color: C.muted2 }}>{new Date(a.createdAt).toLocaleDateString('pt-BR')}</span>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35 }}>{a.title}</div>
                  <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.body}</div>
                  <div style={{ fontSize: 11.5, color: C.muted2, marginTop: 'auto' }}>por {a.author}</div>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button onClick={() => openArticleModal(a)} style={{ padding: '5px 10px', backgroundColor: '#fff', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>editar</button>
                      <button onClick={() => deleteArticle(a.id)} style={{ padding: '5px 10px', backgroundColor: '#fff', border: `1px solid ${C.border}`, color: '#dc2626', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>excluir</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, textAlign: 'center', color: C.muted, fontSize: 14 }}>
              Ainda não há matérias originais. {token ? 'Clique em “+ Nova matéria” para começar.' : 'Em breve: conteúdo produzido pela nossa editoria.'}
            </div>
          )}
        </section>

        {/* SETTINGS */}
        <section id="settings" style={{ paddingTop: 56 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ width: 4, height: 24, backgroundColor: C.blue, borderRadius: 2 }} />
            <h2 style={{ fontSize: isDesktop ? 24 : 20, fontWeight: 700, margin: 0 }}>Configurações</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: 20 }}>
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: '0 1px 3px rgba(15,23,42,.08)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 14 }}>Sessão</div>
              {token ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{(authUser || 'U').slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{authUser}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{isAdmin ? 'Administrador' : 'Editor'} · token JWT ativo</div>
                    </div>
                  </div>
                  <button onClick={doLogout} style={{ padding: '8px 18px', backgroundColor: '#fff', border: `1px solid ${C.border}`, color: C.text, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Sair</button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 14, color: C.muted, marginBottom: 14 }}>Acesse o painel com sua conta de administrador.</div>
                  <button onClick={openLogin} style={{ padding: '10px 22px', backgroundColor: C.blue, border: 'none', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Entrar</button>
                </div>
              )}
            </div>
            <div style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: '0 1px 3px rgba(15,23,42,.08)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 14 }}>Documentação</div>
              <div style={{ fontSize: 14, color: C.muted, marginBottom: 14 }}>Referência interativa dos endpoints da API (OpenAPI/Scalar).</div>
              <a href="/scalar" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', padding: '10px 22px', border: `1px solid ${C.blue}`, color: C.blue, borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Abrir /scalar →</a>
            </div>
          </div>
        </section>

        {/* ADMIN */}
        {token && isAdmin && (
          <section id="admin" style={{ paddingTop: 56 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{ width: 4, height: 24, backgroundColor: C.blue, borderRadius: 2 }} />
              <h2 style={{ fontSize: isDesktop ? 24 : 20, fontWeight: 700, margin: 0 }}>Administração</h2>
            </div>
            <AdminPanel token={token} cities={cities} onCitiesChanged={fetchCitiesAndWeather} onAuthFail={doLogout} />
          </section>
        )}
      </main>

      {/* LOGIN MODAL */}
      {showLogin && (
        <div onClick={() => setShowLogin(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: 16, padding: isDesktop ? 32 : 24, width: 'min(400px, 100%)', boxSizing: 'border-box', boxShadow: '0 20px 50px rgba(15,23,42,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Entrar</h3>
              <button onClick={() => setShowLogin(false)} aria-label="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>Autenticação JWT · Portal Central</div>
            <form onSubmit={doLogin}>
              <input
                value={loginForm.username}
                onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                placeholder="Usuário"
                autoComplete="username"
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none' }}
              />
              <input
                type="password"
                value={loginForm.password}
                onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Senha"
                autoComplete="current-password"
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none' }}
              />
              {loginError && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{loginError}</div>}
              <button type="submit" disabled={loginBusy} style={{ width: '100%', padding: '12px 0', backgroundColor: loginBusy ? C.muted2 : C.blue, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: loginBusy ? 'default' : 'pointer' }}>
                {loginBusy ? 'Verificando...' : 'Entrar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ARTICLE MODAL */}
      {showArticleModal && (
        <div onClick={() => setShowArticleModal(false)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,.6)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ backgroundColor: '#fff', borderRadius: 16, padding: isDesktop ? 32 : 24, width: 'min(520px, 100%)', maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box', boxShadow: '0 20px 50px rgba(15,23,42,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{editingArticle ? 'Editar matéria' : 'Nova matéria'}</h3>
              <button onClick={() => setShowArticleModal(false)} aria-label="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 18 }}>Editoria do Portal Original · autoria: {authUser}</div>
            <form onSubmit={saveArticle}>
              <input
                value={articleForm.title}
                onChange={e => setArticleForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Título"
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none' }}
              />
              <input
                value={articleForm.category}
                onChange={e => setArticleForm(f => ({ ...f, category: e.target.value }))}
                placeholder="Categoria (ex.: Tecnologia)"
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 12, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none' }}
              />
              <textarea
                value={articleForm.body}
                onChange={e => setArticleForm(f => ({ ...f, body: e.target.value }))}
                placeholder="Escreva a matéria..."
                rows={7}
                style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', marginBottom: 16, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 14, outline: 'none', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
              />
              {articleMsg && <div style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{articleMsg}</div>}
              <button type="submit" style={{ width: '100%', padding: '12px 0', backgroundColor: C.blue, color: '#fff', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {editingArticle ? 'Salvar alterações' : 'Publicar matéria'}
              </button>
            </form>
          </div>
        </div>
      )}

      <footer style={{ backgroundColor: C.dark, padding: '28px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: C.muted2 }}>© 2026 Portal Central · Sistema operacional · v2.1.1</div>
      </footer>
    </div>
  );
};

export default App;
