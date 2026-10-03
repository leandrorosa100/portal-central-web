import { useState, useEffect, useRef, type FormEvent } from 'react';

interface CityItem { id: number; name: string; isPrimary: boolean }
interface UserItem { id: number; username: string; role: string }
interface Stats { users: number; cities: number; pins: number; articles: number }
interface CitySuggestion { name: string; admin1: string | null; country: string | null; countryCode: string | null }

interface Props {
  token: string;
  cities: CityItem[];
  onCitiesChanged: () => void;
  onAuthFail: () => void;
}

const C = {
  dark: '#0f172a', dark2: '#1e293b', blue: '#2563eb', card: '#ffffff',
  border: '#e2e8f0', text: '#0f172a', muted: '#64748b', muted2: '#94a3b8',
  ok: '#16a34a',
};

const AdminPanel = ({ token, cities, onCitiesChanged, onAuthFail }: Props) => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [cityError, setCityError] = useState('');
  const [citySearching, setCitySearching] = useState(false);
  const [cityQuery, setCityQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'Editor' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    });
    if (res.status === 401) { onAuthFail(); throw new Error('Sessão expirada — entre novamente'); }
    if (res.status === 403) throw new Error('Seu usuário não tem permissão de administrador.');
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as { message?: string })?.message || `Erro ${res.status}`);
    return data;
  };

  useEffect(() => {
    (async () => {
      try {
        const [s, u] = await Promise.all([api('/admin/stats'), api('/admin/users')]);
        setStats(s); setUsers(u);
      } catch (e) { setMsg((e as Error).message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshStats = async () => {
    try { setStats(await api('/admin/stats')); } catch { /* auth handled in api */ }
  };

  const flagOf = (cc: string | null) =>
    cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map(ch => 127397 + ch.charCodeAt(0))) : '📍';

  const onCityQueryChange = (value: string) => {
    setCityQuery(value);
    setSelectedCity(null); // qualquer digitacao invalida a selecao anterior
    setShowSuggest(true);
    setCityError('');
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (value.trim().length < 2) { setSuggestions([]); return; }
    suggestTimer.current = setTimeout(async () => {
      setCitySearching(true);
      try {
        const res = await fetch(`/api/cities/suggest?q=${encodeURIComponent(value.trim())}`, {
          headers: { Authorization: `Bearer ***}` },
        });
        if (res.status === 403) { setCityError('Seu usuário não tem permissão de administrador.'); setSuggestions([]); setCitySearching(false); return; }
        const list = res.ok ? await res.json() : [];
        setSuggestions(Array.isArray(list) ? list : []);
        if (Array.isArray(list) && list.length === 0) setCityError('Nenhuma cidade encontrada com esse nome.');
      } catch { setSuggestions([]); setCityError('Não foi possível buscar sugestões agora.'); }
      setCitySearching(false);
    }, 300);
  };

  const pickCity = (s: CitySuggestion) => {
    setSelectedCity(s.name);
    setCityQuery(s.name);
    setSuggestions([]);
    setShowSuggest(false);
    setCityError('');
  };

  const onCityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && suggestions.length > 0) {
      e.preventDefault();
      pickCity(suggestions[0]);
    }
  };

  const addCity = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!selectedCity || cityQuery !== selectedCity) {
      setCityError('Selecione uma cidade válida na lista que aparece enquanto digita.');
      setShowSuggest(true);
      return;
    }
    setBusy(true); setMsg(''); setCityError('');
    try {
      await api('/admin/cities', { method: 'POST', body: JSON.stringify({ name: selectedCity, isPrimary: false }) });
      setCityQuery(''); setSelectedCity(null); setSuggestions([]);
      onCitiesChanged();
      refreshStats();
    } catch (e) { setCityError((e as Error).message); } finally { setBusy(false); }
  };

  const removeCity = async (id: number) => {
    setMsg('');
    try {
      await api(`/admin/cities/${id}`, { method: 'DELETE' });
      onCitiesChanged();
      refreshStats();
    } catch (e) { setMsg((e as Error).message); }
  };

  const addUser = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!newUser.username.trim()) { setMsg('Usuário: informe um nome de usuário.'); return; }
    if (newUser.password.length < 8) { setMsg('A senha precisa ter pelo menos 8 caracteres.'); return; }
    setBusy(true); setMsg('');
    try {
      setUsers(await api('/admin/users', { method: 'POST', body: JSON.stringify(newUser) }));
      setNewUser({ username: '', password: '', role: 'Editor' });
      refreshStats();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const removeUser = async (id: number) => {
    setMsg('');
    try {
      setUsers(await api(`/admin/users/${id}`, { method: 'DELETE' }));
      refreshStats();
    } catch (e) { setMsg((e as Error).message); }
  };

  const cardStyle = { backgroundColor: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, boxShadow: '0 1px 3px rgba(15,23,42,.08)', textAlign: 'left' as const };
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, outline: 'none' };
  const btnBlue = { padding: '10px 0', backgroundColor: C.blue, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' };
  const btnGhost = { padding: '5px 10px', backgroundColor: '#fff', border: `1px solid ${C.border}`, color: C.muted, borderRadius: 6, fontSize: 12, cursor: 'pointer' };

  return (
    <div>
      {msg && <div style={{ backgroundColor: '#fef2f2', color: '#dc2626', fontSize: 13, padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>{msg}</div>}

      {/* Estatisticas */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Usuários', value: stats.users },
            { label: 'Cidades', value: stats.cities },
            { label: 'Fixadas', value: stats.pins },
            { label: 'Matérias', value: stats.articles },
          ].map(s => (
            <div key={s.label} style={{ backgroundColor: C.dark, borderRadius: 12, padding: '16px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#93c5fd' }}>{s.value}</div>
              <div style={{ fontSize: 11, color: C.muted2, textTransform: 'uppercase', letterSpacing: '1px', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {/* Cidades */}
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 14 }}>Cidades do clima</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {cities.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>{c.name}{c.isPrimary && <span style={{ fontSize: 11, color: C.blue, marginLeft: 6 }}>· principal</span>}</span>
                <button onClick={() => removeCity(c.id)} style={{ ...btnGhost, color: '#dc2626' }}>remover</button>
              </div>
            ))}
          </div>
          <form onSubmit={addCity} style={{ display: 'flex', gap: 8, position: 'relative' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input
                value={cityQuery}
                onChange={e => onCityQueryChange(e.target.value)}
                onFocus={() => { if (cityQuery.trim().length >= 2) setShowSuggest(true); }}
                onBlur={() => setTimeout(() => setShowSuggest(false), 260)}
                onKeyDown={onCityKeyDown}
                placeholder="Ex.: São Paulo, Lisboa..."
                style={{ ...inputStyle, borderColor: cityError ? '#dc2626' : C.border }}
                autoComplete="off"
              />
              {showSuggest && cityQuery.trim().length >= 2 && (suggestions.length > 0 || citySearching) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, backgroundColor: '#fff', border: `1px solid ${C.border}`, borderRadius: 10, marginTop: 4, boxShadow: '0 10px 30px rgba(15,23,42,.15)', maxHeight: 230, overflowY: 'auto' }}>
                  {citySearching && suggestions.length === 0 ? (
                    <div style={{ padding: '10px 12px', fontSize: 13, color: C.muted }}>Buscando cidades...</div>
                  ) : suggestions.map((s, i) => (
                    <div
                      key={`${s.name}-${i}`}
                      onMouseDown={() => pickCity(s)}
                      onTouchStart={() => pickCity(s)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', cursor: 'pointer', borderBottom: i < suggestions.length - 1 ? `1px solid ${C.border}` : 'none' }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <span style={{ fontSize: 15 }}>{flagOf(s.countryCode)}</span>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</span>
                      <span style={{ fontSize: 11.5, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {[s.admin1, s.country].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="submit" disabled={busy} style={{ ...btnBlue, padding: '10px 18px' }}>Adicionar</button>
          </form>
          <div style={{ fontSize: 11.5, marginTop: 8, color: cityError ? '#dc2626' : C.muted2, fontWeight: cityError ? 600 : 400 }}>
            {cityError || (selectedCity ? `✓ ${selectedCity} selecionada` : 'Digite pelo menos 2 letras e escolha uma cidade na lista.')}
          </div>
        </div>

        {/* Usuarios */}
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 14 }}>Usuários</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {users.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 12px', border: `1px solid ${C.border}`, borderRadius: 8 }}>
                <span style={{ fontSize: 14 }}>
                  {u.username} <span style={{ fontSize: 11, color: u.role === 'Admin' ? C.blue : C.muted2, marginLeft: 6 }}>({u.role})</span>
                </span>
                <button onClick={() => removeUser(u.id)} style={{ ...btnGhost, color: '#dc2626' }}>excluir</button>
              </div>
            ))}
          </div>
          <form onSubmit={addUser} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={newUser.username} onChange={e => setNewUser(f => ({ ...f, username: e.target.value }))} placeholder="Usuário" style={{ ...inputStyle, flex: 1 }} />
              <select value={newUser.role} onChange={e => setNewUser(f => ({ ...f, role: e.target.value }))} style={{ ...inputStyle, width: 96 }}>
                <option value="Editor">Editor</option>
                <option value="Admin">Admin</option>
              </select>
            </div>
            <input type="password" value={newUser.password} onChange={e => setNewUser(f => ({ ...f, password: e.target.value }))} placeholder="Senha (mínimo 8 caracteres)" style={inputStyle} />
            <button type="submit" disabled={busy} style={btnBlue}>Criar usuário</button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
