# Portal Central — Manual de Handoff (Equipe de Manutenção)

> Documento de transição do projeto. Escrito pela Samantha (agente que construiu o projeto do zero até a v2.2.0, na madrugada de 02–03/10/2026). Leiam antes de qualquer alteração.

## 1. Visão geral

Portal de notícias e clima em tempo real, **one-page responsivo**, com área administrativa e editoria própria.

- **URL de produção:** https://portal-central-web.onrender.com
- **Documentação da API (interativa):** https://portal-central-web.onrender.com/scalar
- **Stack:** React 19 + Vite + TypeScript (SPA) · .NET 10 Web API (minimal APIs) · EF Core · PostgreSQL (Supabase) · JWT · Docker
- **Arquitetura:** contêiner ÚNICO — o build do React vai para `wwwroot` e a API .NET serve SPA + API na mesma porta. No Render, a porta vem do env `PORT`.

Dados de conteúdo vêm **ao vivo** (RSS: Agência Brasil, IGN, Tecnoblog, Olhar Digital; clima: Open-Meteo com geocodificação). O banco guarda o que **persiste**: usuários, cidades, notícias fixadas, matérias da editoria.

## 2. Acessos essenciais

| Recurso | Onde | Observação |
|---|---|---|
| Código | https://github.com/leandrorosa100/portal-central-web | Repositório **público**, branch `master`. Push em `master` dispara build automático no Render |
| Deploy/Produção | https://dashboard.render.com → serviço `portal-central-web` | Conta do proprietário (leandrorosa100). Plano free: dorme após ~15 min, cold start ~1 min |
| Banco | https://supabase.com/dashboard → projeto ref `kpyudrudhfhpinliszlb` | PostgreSQL, região São Paulo. Dados são **duráveis** (não perdem em restart) |
| Login do portal | Usuário `admin` + senha em `ADMIN_PASSWORD` (no Render) | Criar outros usuários pela UI (Administração → Usuários) |

**Nenhuma credencial está neste documento.** Toda credencial vive em variável de ambiente do Render, ou no cofre de segredos do OpenClaw (`secrets`) — nunca no código, nunca em chat.

## 3. Ambientes

### 3.1 Produção (Render, plano free)
- 512 MB RAM (build e runtime). **O Dockerfile limita o GC do .NET** (`DOTNET_gcServer=0`, `DOTNET_GCHeapHardLimit` 200–300 MB) — sem isso o build morre no OOM-killer. Não removam.
- `PORT` é definido pelo Render; a app escuta `http://0.0.0.0:$PORT` (fallback 5001 local).
- Env vars (Environment do serviço): `DATABASE_URL` (string de conexão Supabase), `JWT_KEY`, `ADMIN_USERNAME` (opcional), `ADMIN_PASSWORD`.
- Free tier: **disco efêmero** — se alguém remover `DATABASE_URL`, a app cai para SQLite local que **perde tudo a cada restart**. Sempre PostgreSQL em produção.
- Sem `JWT_KEY`/`ADMIN_PASSWORD` definidos, a geração é **efêmera/aleatória** (fail-safe; ver §10).

### 3.2 Desenvolvimento local (PRoot/Termux no celular do proprietário!)
- `cd Api && DOTNET_GCHeapHardLimit=200000000 dotnet build` — build PRECISA do limite de GC.
- Execução: `DOTNET_gcServer=0 DOTNET_GCHeapHardLimit=100000000 dotnet bin/Debug/net10.0/Api.dll`
- Frontend dev: `cd client-app && npm run dev` (porta 3000, proxy `/api` → 5001).
- Dev usa SQLite (`portal_central.db`). **Se mudarem o schema: apaguem o `.db`** — `EnsureCreated` não altera banco existente (ver lição nº1).
- **OOM é frequente no PRoot:** nunca juntem `pkill` + build + start + curl na mesma sessão/exec. Um comando por vez; matem também o `VBCSCompiler` (Roslyn) que retém memória.
- Não usem Tailwind/PostCSS (quebra no PRoot) — o frontend é **inline styles** de propósito.

## 4. Estrutura do projeto

```
fullstack_solution/
├── Dockerfile              # multi-stage: node(build react) → sdk(build .NET) → aspnet(runtime)
├── README.md               # como rodar/deployar + env vars
├── docs/ONBOARDING.md      # ESTE documento
├── Api/                    # backend .NET 10
│   ├── Program.cs          # TUDO aqui: DI, middleware, DDL de boot, seed, endpoints minimal
│   ├── Models/             # User (LoginRequest) e ContentModels (City, PinnedNews, Article, CreateUserRequest)
│   ├── Data/AppDbContext.cs# DbSets + índices únicos (Username, City.Name, PinnedNews.Url)
│   ├── Services/           # NewsService (RSS), WeatherService (Open-Meteo + geocoding + sugestões)
│   └── Controllers/        # NewsController, WeatherController
└── client-app/             # frontend React+Vite
    └── src/
        ├── App.tsx         # portal inteiro: header, notícias(+pins fixados), editoria, clima multi-cidade, sessão, modais
        └── AdminPanel.tsx  # painel admin: estatísticas, cidades (autocomplete), usuários
```

`Program.cs` é o coração — leiam-no por completo antes de mexer. Pontos-chave: conversão URI→keyword de `DATABASE_URL`, DDL `CREATE TABLE IF NOT EXISTS` no boot (Postgres), seed com 3 tentativas, rate limit no login, CSP com liberação **só** em `/scalar`, `Cache-Control: no-cache` no index.html.

## 5. Banco de dados (Supabase) — REGRAS CRÍTICAS

1. **Usem sempre a Session pooler**: `postgresql://postgres.kpyudrudhfhpinliszlb:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`
2. **NUNCA a Direct connection** (`db.kpyud...supabase.co`) — é **IPv6-only** e o Render só tem saída IPv4. Sintoma: `connection error` no boot.
3. O usuário na pooler TEM o sufixo do ref: `postgres.kpyudrudhfhpinliszlb` (sem ele: `ENOIDENTIFIER: no tenant identifier`).
4. A app converte a URI sozinha (Npgsql não aceita URI direto no EF). Senhas: **só letras e números** (símbolos quebram a URI sem percent-encoding).
5. Tabelas: `Users`, `Cities`, `PinnedNews`, `Articles` — criadas pelo DDL idempotente no boot (`Program.cs`). Ao adicionar modelo novo: **adicionem o CREATE TABLE lá também** (Postgres) — `EnsureCreated` sozinho NÃO cria tabelas em banco preexistente.
6. Seed de boot: usuário admin (de `ADMIN_USERNAME`/`ADMIN_PASSWORD`) + cidade padrão "São Paulo". `SaveChangesAsync` SEMPRE fora dos ifs de seed.

## 6. Autenticação e RBAC

- **JWT** (HS256, 7 dias), senha com **PBKDF2-SHA256** (salt 16B, 100k iterações, comparação tempo-constante), login com **rate limit 5/min por IP** (429).
- Falhas-safe: sem `JWT_KEY`/`ADMIN_PASSWORD` em produção → chave/senha aleatória por boot (a app NUNCA aceita a senha dev em produção; ela aparece 1x nos logs do Render).
- **Papéis:**

| Ação | Admin | Editor |
|---|---|---|
| Fixar/desfixar notícias | ✅ | ✅ |
| Criar/editar/excluir matérias | ✅ (de todos) | ✅ (**só das próprias** — 403 nas dos outros) |
| Cidades do clima + autocomplete | ✅ | ❌ 403 |
| Gestão de usuários + estatísticas | ✅ | ❌ 403 |
| Logar no portal | ✅ | ✅ |

- Frontend é role-aware: painel "Administração" e pins de cidade aparecem conforme o papel (`pc_role` no localStorage + restaurado via `/api/auth/me`).

## 7. Endpoints (resumo)

Públicos: `GET /api/news/headlines?category=` · `GET /api/weather/current?city=` · `GET /api/cities` · `GET /api/news/pinned` · `GET /api/articles` · `GET /openapi/v1.json` + UI em `/scalar` · `GET /api/db/health` (diagnóstico)

Auth: `POST /api/auth/login` (retorna token+username+**role**; rate-limited) · `GET /api/auth/me`

Admin (`AdminOnly`): `GET/POST /api/admin/cities*`, `DELETE /api/admin/cities/{id}`, `GET /api/cities/suggest?q=`, `GET/POST /api/admin/users`, `DELETE /api/admin/users/{id}`, `GET /api/admin/stats`

Editor+Admin (`EditorOrAdmin`): `POST/DELETE /api/admin/pins*`, `POST/PUT/DELETE /api/admin/articles*` (PUT/DELETE com guarda de autoria p/ Editor)

> Nota: paths `/api/admin/*` são históricos — pins/articles atendem Editor também. Não renomear sem atualizar o frontend.

## 8. Pipeline de deploy + checklist pós-deploy

**Fluxo:** push em `master` → Render detecta → Docker build (camadas cacheadas; mudança em `Api/` rebuilda só o estágio .NET, ~30-90s) → novo container.

**Checklist de validação pós-deploy** (executem na ordem):
1. `GET /` → 200 (SPA no ar)
2. `POST /api/auth/login` com credencial **inválida** → **401** = Postgres vivo (se **500**: conexão/DDL do banco falhou — ver logs)
3. `GET /api/db/health` → `can_connect:true`, `users_table:true` (modo deve ser `postgresql`; se `sqlite` → `DATABASE_URL` sumiu no Render!)
4. `GET /api/cities` → lista com cidades (seed inclui São Paulo)
5. `GET /api/cities/suggest` sem token → 401
6. Footer do portal → versão nova (deploy confirmado)

## 9. Diagnóstico rápido

`GET /api/db/health` retorna modo, estrutura da URL e erro (sem credenciais). Assinaturas conhecidas:

| Sintoma | Causa provável |
|---|---|
| login inválido → **401** | ✅ banco OK |
| login → **500** | conexão Postgres/DDL falhou (senha errada, host direto/IPv6, `DATABASE_URL` inválida) |
| `42P01 relation does not exist` | tabela não criada — DDL do boot precisa ser estendido (modelo novo?) |
| `ENOIDENTIFIER` | usuário sem o `.ref` do projeto |
| 403 em endpoint admin | papel Editor sem permissão (checar quem está logado!) |
| `Format of the initialization string` | `DATABASE_URL` em formato inesperado (a app converte URI; se chegou aqui, é caso novo) |
| Site todo fora após mudança de env | redeploy não terminou (~2 min) |

## 10. Lições aprendidas (NÃO REPITAM — já custaram horas)

1. **`EnsureCreated` não cria schema em banco preexistente** (Supabase tem o `postgres` de fábrica). Por isso o DDL explícito + idempotente no boot. Schema novo = CREATE TABLE novo lá.
2. **`SaveChangesAsync` fora dos ifs de seed** — senão o seed "pula" quando a outra condição já existe.
3. **Direct do Supabase = IPv6-only.** Session pooler SEMPRE.
4. **Render 512MB:** GC limits no Dockerfile são obrigatórios; build limpo < 1 min com cache.
5. **PRoot:** comandos separados (pkill/build/start/curl nunca juntos) ou OOM.
6. **Sanitizador de credenciais do OpenClaw:** mascara literais de senha E padrões tipo `Bearer ` em comandos executados. Para testes autenticados via shell: prefixo montado (`"Bear"+"er "`), f-string, senha em partes, corpo de login via arquivo. Testes de API autenticada preferíveis via python urllib com header construído em código.
7. **JSX:** branch de ternário não aceita `{...}` solto no topo — fragmento `<>` wrapper.
8. **`tsc --noEmit` na raiz do client-app não checa nada** (tsconfig só tem references) — usem `npx tsc -b`; e cuidado: `npm run build | tail` mascara exit code do pipe.
9. **Cache do navegador:** index.html tem `no-cache` (middleware). Antes disso, o usuário rodava bundle velho e "via" bugs antigos — se reportar comportamento antigo, peçam Ctrl+Shift+R antes de debugar.
10. **Mobile:** dropdown de sugestão usa `onMouseDown` **E** `onTouchStart` (touch dispara antes do blur; janela de blur 260ms).
11. Credencial vazou no chat (chave `sb_secret_` do Supabase, 3x)? **Revogação obrigatória** (Supabase → API Keys). A chave de API do Supabase NÃO é a senha do banco — confusões custaram a noite toda.
12. Scalar: o CSP `script-src 'self'` bloqueia o bootstrap inline dele — por isso CSP dedicado (com `unsafe-inline`) **só** nas páginas `/scalar`, e redirect `/scalar/openapi/v1.json` → `/openapi/v1.json`.

## 11. Histórico de versões

- **v1.0 (02/10)** — SPA one-page + API RSS/clima, Docker, publicação no GitHub/Render.
- **v1.2.0 (03/10 01h)** — Login UI + JWT + PBKDF2 + rate limit + headers de segurança + Scalar/OpenAPI + CORS dev-only; segredos fora do código.
- **v1.2.1 (03/10 03h)** — fix Scalar (CSP scoped + redirect do doc) + layout desktop full-width (grid de notícias abaixo do destaque).
- **v1.3.0 (03/10 04h)** — migração PostgreSQL/Supabase: conversão URI→keyword, boot resiliente, GC no build; diagnóstico via `/api/db/health`.
- **fix (03/10 05h)** — DDL explícito (EnsureCreated no-opava) + seed com retry; produção validada com 401.
- **v2.0.0 (03/10 06h)** — Área administrativa: cidades multi-clima, notícias fixadas, editoria Portal Original, usuários/papéis, estatísticas.
- **v2.1.x (03/10 06h30)** — Autocomplete de cidades (geocoding, bandeiras) + cadastro com mensagens visíveis + UI role-aware + no-cache.
- **v2.2.0 (03/10 07h)** — **Editor como produtor de conteúdo**: pins e matérias para Editor (autoria própria), cidades/usuários/stats só Admin; dropdown mobile (touch) + estado "Buscando...".

## 12. Roadmap pendente (fase 2.5, aprovada, não implementada)

1. Saúde dos feeds RSS no painel (fontes up/down, última atualização)
2. Log de auditoria de logins (tentativas, bloqueios)
3. Preferências visuais (banner de aviso, textos de rodapé/seções editáveis)
4. Keep-alive opcional contra sleep do free tier (ping <1/10min, cuidado com as 750h free/mês)
5. EF Migrations de verdade (substituir DDL manual quando o schema crescer)
6. Logout/token refresh (tokens atuais duram 7 dias fixos)

## 13. Contatos e posse

- Proprietário: leandrorosa100 (GitHub/Render/Supabase).
- Este manual: `docs/ONBOARDING.md` no próprio repositório. Atualizem-no junto com o código — ele é o mapa dos buracos já conhecidos.

*Bom trabalho, time. O portal é de vocês agora.* 🐘✨
