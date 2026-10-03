# Portal Central

Portal de notícias e clima em tempo real — notícias via RSS de portais brasileiros (Agência Brasil, IGN, Tecnoblog, Olhar Digital) e clima via Open-Meteo. **Nenhuma chave de API necessária.**

**Stack:** React 19 + Vite (frontend) · .NET 10 Web API (backend) · SQLite/EF Core (persistência) · JWT (autenticação)

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

| Variável | Padrão (dev) | Descrição |
|---|---|---|
| `PORT` | `5001` | Porta do servidor (o Render define automaticamente) |
| `JWT_KEY` | chave dev-only | **Defina em produção** — segredo de assinatura dos tokens |
| `ADMIN_USERNAME` | `admin` | Usuário admin criado no primeiro boot |
| `ADMIN_PASSWORD` | `Admin@123` | **Defina em produção** — senha do admin inicial |

No Render: **Environment** → adicione `JWT_KEY` e `ADMIN_PASSWORD` com valores fortes.
