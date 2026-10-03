# ---- Stage 1: Build React frontend ----
FROM node:22-alpine AS client
WORKDIR /app
COPY client-app/package*.json ./
RUN npm ci
COPY client-app/ ./
RUN npm run build

# ---- Stage 2: Build .NET backend ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY Api/Api.csproj ./
RUN dotnet restore
COPY Api/ ./
RUN dotnet publish -c Release -o out

# ---- Stage 3: Runtime (single container serves API + SPA) ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
ENV DOTNET_gcServer=0 \
    DOTNET_GCHeapHardLimit=200000000 \
    ASPNETCORE_ENVIRONMENT=Production
COPY --from=api /src/out .
COPY --from=client /app/dist ./wwwroot
EXPOSE 10000
ENTRYPOINT ["dotnet", "Api.dll"]
