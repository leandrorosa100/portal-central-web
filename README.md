# Portal Central

Portal de notícias e clima em tempo real — notícias via RSS de portais brasileiros (Agência Brasil, IGN, Tecnoblog, Olhar Digital) e clima via Open-Meteo. **Nenhuma chave de API necessária.**

**Stack:** React 19 + Vite (frontend) · .NET 10 Web API (backend) · SQLite/EF Core (persistência) · JWT (autenticação)

## Funcionalidades

- **Portal one-page responsivo** — notícias por categoria, clima em tempo real, menu lateral mobile
- **Login JWT na UI** — modal de autenticação (`Entrar` no header/drawer), sessão persistida em `localStorage`, logout
- **Senhas com PBKDF2-SHA256** — salt por usuário, 100k iterações, comparação em tempo constante (nunca texto puro)
- **Rate limiting** — 5 tentativas de login/min por IP (429 após exceder)
- **Documentação interativa** — Scalar UI em `/scalar` + OpenAPI em `/openapi/v1.json` (todos os ambientes)
- **Headers de segurança** — CSP, X-Frame-Options, nosniff, Referrer-Policy
- **HTTPS forçado** — via proxy reverso (Render) com `ForwardedHeaders`

## Rodar localmente

```bash
# Backend (porta 5001) — no PRoot, o limite de GC é obrigatório
cd Api
DOTNET_GCHeapHardLimit=200000000 dotnet build
DOTNET_gcServer=0 DOTNET_GCHeapHardLimit=100000000 dotnet bin/Debug/net10.0/Api.dll

# Frontend dev (porta 3000, proxy /api -> 5001)
cd client-app
npm install
npm run dev
```

## Deploy no Render (grátis, sem cartão)

1. Suba o conteúdo desta pasta para um repositório no **GitHub** (sem `node_modules`, `bin`, `obj` — veja o `.gitignore`).
2. Crie conta gratuita em [render.com](https://render.com) usando o login do GitHub.
3. **New + → Web Service** → conecte o repositório.
4. O Render detecta o `Dockerfile` automaticamente → **Create Web Service** → aguarde o build (~3-5 min).
5. Pronto: o app fica em `https://SEU-NOME.onrender.com` (HTTPS automático).

> O contêiner único serve o React compilado (wwwroot) e a API na mesma porta. O serviço gratuito dorme após ~15 min sem visitas e acorda em ~1 min.

## Variáveis de ambiente

| Variável | Padrão (dev) | Comportamento em produção sem a variável |
|---|---|---|
| `PORT` | `5001` | Definido automaticamente pelo Render |
| `JWT_KEY` | chave dev-only | Gera chave **efêmera aleatória** (sessões caem a cada restart) |
| `ADMIN_USERNAME` | `admin` | `admin` |
| `ADMIN_PASSWORD` | `Admin@123` | Gera senha **aleatória de uso único** (visível só nos logs do serviço) |

No Render: **Environment** → adicione `JWT_KEY` (texto longo aleatório, 40+ caracteres) e `ADMIN_PASSWORD` (senha forte sua). Sem elas o app **nunca** aceita a senha dev — é a proteção fail-safe contra segredos públicos em repositório aberto.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/news/headlines?category=` | Manchetes RSS (sports, politics, games, technology, innovation) |
| GET | `/api/weather/current` | Clima atual via Open-Meteo (São Paulo) |
| POST | `/api/auth/login` | Login → `{ token, username }` (rate-limited) |
| GET | `/api/auth/me` | Dados da sessão (requer `Authorization: Bearer <token>`) |
| GET | `/scalar`, `/openapi/v1.json` | Documentação interativa da API |
