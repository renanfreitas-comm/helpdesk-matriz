# Help Desk Matriz

Plataforma web para gerenciamento das atividades do time de Help Desk. Permite abrir e acompanhar chamados, atribuir responsáveis, registrar relatórios diários de atividades, manter a configuração das máquinas do parque de TI, controlar o estoque de peças/periféricos, acompanhar indicadores em um dashboard e supervisionar a produtividade do time — com papéis de Técnico e Supervisor/Admin.

## Como o projeto funciona

- O **site** (HTML, CSS, JS) é hospedado gratuitamente pelo **GitHub Pages**.
- Os **dados** (chamados e usuários) e o **login** ficam no **Firebase** (Google), também no plano gratuito. O GitHub Pages sozinho não guarda dados, por isso o Firebase entra como o "banco de dados" da aplicação.
- Não é necessário programar nenhum servidor: o navegador do usuário conversa direto com o Firebase.

Estrutura de arquivos:

```
helpdesk-matriz/
├── index.html            # Tela de login (sem cadastro público)
├── dashboard.html        # Indicadores (visão geral)
├── chamados.html         # Lista de chamados, criação, edição, atribuição
├── relatorios.html       # Relatórios diários de atividades (por técnico)
├── maquinas.html         # Configuração de máquinas + histórico de manutenções
├── estoque.html          # Estoque de peças/periféricos + movimentações
├── usuarios.html         # Gestão de usuários (somente admin)
├── supervisao.html       # Supervisão: relatórios do time e produtividade (somente admin)
├── css/style.css         # Estilo visual (cores da marca Comm)
├── assets/
│   ├── logo-comm.png         # Logo principal, versão escura (fundos claros)
│   ├── logo-comm-branco.png  # Logo principal, versão branca (usada na barra escura da tela de login)
│   └── logo-ti.png            # Logo secundária (selo do setor de TI)
├── js/
│   ├── firebase-config.js   # Credenciais do Firebase (você vai editar)
│   ├── auth.js               # Login, criação de usuários (pelo admin), proteção de páginas
│   ├── nav.js                 # Cabeçalho comum
│   ├── chamados.js
│   ├── dashboard.js
│   ├── usuarios.js
│   ├── relatorios.js
│   ├── maquinas.js
│   ├── estoque.js
│   ├── supervisao.js
│   └── index.js
├── apps-script/Codigo.gs  # Backend gratuito (laudos no Drive + e-mails) — vai no script.google.com
├── firestore.rules        # Regras de segurança do banco (você vai colar no console do Firebase)
├── firestore.indexes.json # Índice composto exigido pela tela de Relatórios
├── firebase.json          # Permite publicar regras/índices com o Firebase CLI (opcional)
└── .firebaserc            # Projeto Firebase padrão para o CLI (opcional)
```

### O que cada módulo faz

- **Chamados**: abertura e acompanhamento dos chamados de suporte. Ao criar um chamado, o técnico preenche número do chamado, área atendida e atividade realizada; prioridade, responsável e status continuam disponíveis para organização e para os indicadores do dashboard.
- **Relatórios**: cada técnico monta o relatório diário de atividades como uma pequena tabela (igual ao modelo em papel/planilha usado pela equipe): para cada linha, informa categoria, atividade, quantidade/área e status (Concluído, Em andamento ou Pendente), podendo adicionar quantas linhas quiser com o botão "+ Adicionar atividade". Um campo de resumo no final é opcional. Cada um vê o próprio histórico.
- **Máquinas**: cadastro do parque de máquinas (nome/patrimônio, setor, usuário responsável, status) com especificações técnicas (SO, processador, RAM, armazenamento, IP) e um histórico de manutenções por máquina — toda vez que alguém mexe numa máquina, registra ali.
- **Estoque**: controle dos equipamentos que passam pela TI (chegada, configuração e saída), no mesmo formato da planilha usada pela equipe — cada item registra equipamento, S/N, ativo, data de chegada, delegação, prioridade, data de saída, técnico responsável, loja/setor e situação (Recebido, Em configuração, Aguardando peça, Concluído ou Entregue). Não há controle de quantidade/estoque mínimo nesta versão — é um registro individual por equipamento.
- **Usuários** (somente admin): não existe cadastro público — só um admin cria novas contas por aqui (nome, e-mail, senha temporária e papel), além de promover/rebaixar técnicos e admins.
- **Supervisão** (somente admin): visão consolidada dos relatórios diários de todo o time (com a mesma tabela de atividades), filtrável por técnico e por período, com um resumo de produtividade (chamados resolvidos + relatórios enviados) por pessoa.

---

## Passo 1 — Criar o projeto no Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com/) e faça login com uma conta Google (pode ser a do trabalho).
2. Clique em **Criar projeto** (ou "Add project").
3. Dê um nome, por exemplo `helpdesk-matriz`. Pode desativar o Google Analytics (não é necessário).
4. Aguarde a criação do projeto.

## Passo 2 — Ativar o login por e-mail/senha

1. No menu lateral, vá em **Compilar (Build) → Authentication**.
2. Clique em **Vamos começar (Get started)**.
3. Na aba **Sign-in method**, clique em **E-mail/senha** e ative a primeira opção. Salve.

## Passo 3 — Criar o banco de dados (Firestore)

1. No menu lateral, vá em **Compilar (Build) → Firestore Database**.
2. Clique em **Criar banco de dados (Create database)**.
3. Escolha o modo **produção** (production mode) e a localização mais próxima (ex.: `southamerica-east1` para o Brasil).
4. Depois de criado, vá na aba **Regras (Rules)** e substitua todo o conteúdo pelo texto do arquivo **`firestore.rules`** (está nesta pasta do projeto). Clique em **Publicar (Publish)**.

Essas regras garantem que:
- Só quem está logado **e tem perfil em `usuarios`** enxerga chamados, relatórios, máquinas, estoque, visitas e usuários. Excluir alguém na tela Usuários corta o acesso na hora.
- Ninguém consegue se promover a admin: só admins criam perfis e mudam papéis (e um admin não consegue excluir a própria conta).
- Técnicos só mudam o **status** dos chamados em que são responsáveis, e abrem chamados sempre como "Aberto" e sem responsável.
- Cada técnico só vê e edita os **próprios** relatórios; admins veem todos.
- Visitas só podem ser editadas por quem as registrou ou por um admin; o link do laudo só aceita endereços do Google Drive.
- Campos de autoria (quem criou, quando criou) não podem ser falsificados nem alterados depois, e cada campo tem tipo e tamanho validados.
- Excluir chamados, máquinas, itens de estoque e visitas: só admins. Qualquer coleção fora dessa lista fica bloqueada.

### Criar o índice da tela de Relatórios (importante)

A tela de **Relatórios** (visão do técnico) busca "relatórios deste técnico, ordenados por data". O Firestore exige um **índice composto** para isso, e ele não vem criado por padrão. Escolha **um** dos caminhos:

- **Pelo console (mais simples):** Firestore Database → aba **Índices (Indexes)** → **Composto** → **Criar índice**. Coleção: `relatorios`. Campos: `tecnicoUid` **Crescente** e `data` **Decrescente**. Escopo: Coleção. Clique em **Criar** e aguarde ~1 minuto até o status ficar "Ativado".
- **Pelo link do erro:** se a tela de Relatórios mostrar um erro de índice, abra o console do navegador (F12 → Console), clique no link azul que aparece junto da mensagem *"The query requires an index"* e confirme em **Criar índice**.
- **Pelo Firebase CLI (opcional):** com o [Firebase CLI](https://firebase.google.com/docs/cli) instalado, rode na pasta do projeto `firebase login` e depois `firebase deploy --only firestore`. Isso publica de uma vez as regras (`firestore.rules`) e o índice (`firestore.indexes.json`).

As demais telas usam só ordenações simples, que o Firestore indexa sozinho.

## Passo 4 — Pegar as credenciais do app web

1. No console do Firebase, clique no ícone de engrenagem ⚙️ ao lado de "Project Overview" → **Configurações do projeto**.
2. Em "Seus aplicativos", clique no ícone **</>** (Web) para registrar um app.
3. Dê um apelido (ex.: `helpdesk-web`) e clique em **Registrar app**. Não precisa marcar a opção de Hosting.
4. O Firebase vai mostrar um bloco de código com `firebaseConfig = { apiKey: ..., authDomain: ..., ... }`. Copie esses valores.
5. Abra o arquivo **`js/firebase-config.js`** neste projeto e cole cada valor no lugar de `"COLE_AQUI_..."`. Exemplo:

```js
const firebaseConfig = {
  apiKey: "AIzaSyD...........",
  authDomain: "helpdesk-matriz.firebaseapp.com",
  projectId: "helpdesk-matriz",
  storageBucket: "helpdesk-matriz.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

Salve o arquivo.

---

## Passo 4.1 — Backend gratuito do módulo de Visitas (Google Apps Script)

O módulo de **Visitas Técnicas** guarda os laudos (PDF/DOCX) no Google Drive e envia e-mails automáticos. Isso é feito por um Google Apps Script gratuito, cujo código está em **`apps-script/Codigo.gs`**.

1. Acesse [script.google.com](https://script.google.com) com a conta Google que vai guardar os laudos e abra o projeto existente (ou clique em **Novo projeto**).
2. Apague o conteúdo do arquivo `Código.gs` e cole **todo** o conteúdo de `apps-script/Codigo.gs`.
3. No topo do arquivo, confira:
   - `TOKEN_SECRETO` → igual ao `APPS_SCRIPT_TOKEN` de `js/apps-script-config.js`.
   - `FIREBASE_PROJECT_ID` e `FIREBASE_API_KEY` → os mesmos de `js/firebase-config.js` (já vêm preenchidos).
   - `COMPARTILHAMENTO_LAUDO` → `"LINK"` (qualquer pessoa com o link abre) ou `"DOMINIO"` (só contas do seu Google Workspace).
4. Salve, escolha a função **`autorizar`** na barra superior e clique em **Executar**. Aceite as permissões (Drive, Gmail e acesso externo).
5. Publique:
   - **Primeira vez:** **Implantar → Nova implantação → App da Web**. Executar como: **Eu**. Quem pode acessar: **Qualquer pessoa**. Copie a URL gerada para `APPS_SCRIPT_URL` em `js/apps-script-config.js`.
   - **Atualizando:** **Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar.** Assim a URL continua a mesma e o site não precisa mudar.

**Segurança:** o token fica visível no código do site, então sozinho ele não protege nada. Por isso o site envia junto o *idToken* do usuário logado, e o script confere no Firestore se a pessoa tem perfil em `usuarios` antes de salvar laudos ou enviar e-mails. E-mails só são enviados para endereços cadastrados em `usuarios` (com limite de 30 envios por hora por usuário). Se precisar desligar essa checagem temporariamente, mude `EXIGIR_LOGIN_FIREBASE` para `false`.

Os laudos ficam na pasta **"Help Desk Matriz - Laudos"** do Drive dessa conta. Ao substituir o laudo de uma visita, o arquivo antigo vai para a lixeira do Drive.

---

## Passo 5 — Subir o projeto para o GitHub

Se ainda não tiver o [Git](https://git-scm.com/downloads) instalado, instale primeiro. Depois, no terminal, dentro da pasta do projeto (`helpdesk-matriz`):

```bash
git init
git add .
git commit -m "Primeira versão da plataforma Help Desk Matriz"
```

Agora crie um repositório novo no GitHub (github.com → botão **New repository**), sem marcar "Add a README" (para não dar conflito). Copie a URL que o GitHub mostrar e rode:

```bash
git remote add origin https://github.com/SEU-USUARIO/helpdesk-matriz.git
git branch -M main
git push -u origin main
```

## Passo 6 — Ativar o GitHub Pages

1. No repositório, vá em **Settings → Pages**.
2. Em "Build and deployment", em **Source**, escolha **Deploy from a branch**.
3. Em **Branch**, selecione `main` e a pasta `/ (root)`. Clique em **Save**.
4. Aguarde 1 a 2 minutos. O GitHub vai mostrar a URL do site, algo como:
   `https://SEU-USUARIO.github.io/helpdesk-matriz/`

Pronto — o site está no ar!

## Passo 7 — Liberar o domínio do GitHub Pages no Firebase

Por segurança, o Firebase só aceita pedidos de login vindos de domínios autorizados.

1. No console do Firebase, vá em **Authentication → Settings → Authorized domains**.
2. Clique em **Add domain** e adicione: `SEU-USUARIO.github.io`.

## Passo 8 — Criar o primeiro admin (manualmente, só uma vez)

Não existe cadastro público nesta plataforma — nem mesmo o primeiro usuário se cadastra sozinho pela tela de login. Por isso, a primeiríssima conta (a sua, de admin) precisa ser criada diretamente no Console do Firebase. É rápido e só precisa ser feito uma única vez:

> 📄 **Seus dados já estão prontos** no arquivo `ADMIN-INICIAL-NAO-SUBIR.txt` (nesta mesma pasta) — nome, e-mail, senha e o papel a usar em cada campo abaixo. Esse arquivo já está no `.gitignore` para nunca ser enviado ao GitHub; depois de usá-lo, é uma boa ideia apagá-lo do seu computador ou trocar a senha pelo link "Esqueci minha senha" assim que entrar pela primeira vez.

1. No console do Firebase, vá em **Authentication → Users (Usuários)** e clique em **Add user (Adicionar usuário)**.
2. Preencha seu e-mail e uma senha, e clique em **Add user**. Copie o **User UID** que aparece na lista (uma sequência de letras e números) — vai precisar dele no próximo passo.
3. Vá em **Firestore Database → Data (Dados)** e clique em **Start collection (Iniciar coleção)**.
4. Em "Collection ID", digite `usuarios`. Em "Document ID", **cole o User UID** que você copiou (não deixe no automático).
5. Adicione os seguintes campos ao documento:
   - `nome` (tipo *string*) → seu nome
   - `email` (tipo *string*) → o mesmo e-mail que você cadastrou no passo 1 (em minúsculas)
   - `papel` (tipo *string*) → `admin`
   - `criadoEm` (tipo *timestamp*) → pode deixar a data/hora atual
6. Clique em **Save (Salvar)**.

Pronto — agora é só acessar a URL do seu site e entrar com esse e-mail e senha. Você já entra como Supervisor/Admin.

## Passo 9 — Cadastrando o restante do time

Com a conta de admin já funcionando, todo o resto do cadastro é feito **de dentro do próprio site**, sem precisar voltar ao Console do Firebase:

1. Faça login e entre em **Usuários** no menu.
2. Clique em **+ Novo usuário**, preencha nome, e-mail, uma senha temporária e o papel (Técnico ou Supervisor/Admin), e clique em **Criar usuário**.
3. Repasse o e-mail e a senha temporária para a pessoa por um canal seguro (ex.: mensagem direta, não um grupo). Ela pode trocar a senha a qualquer momento clicando em **Esqueci minha senha** na tela de login.

---

## Testar no seu computador antes de publicar (opcional)

Como o projeto usa módulos JavaScript (`type="module"`), abrir o `index.html` direto com duplo clique não funciona — o navegador bloqueia por segurança. Rode um servidor local simples:

```bash
# Se tiver Python instalado:
python3 -m http.server 8000
```

Depois acesse `http://localhost:8000` no navegador. Lembre-se de adicionar `localhost` como domínio autorizado no Firebase (Passo 7) se quiser testar o login localmente.

---

## Limitações e observações

- **Plano gratuito do Firebase (Spark):** suporta bem um time de até algumas dezenas de pessoas com uso normal de um help desk interno. Se crescer muito, vale acompanhar o uso no painel do Firebase.
- **Cadastro fechado:** só um admin cria novas contas (tela Usuários). Não existe formulário público de cadastro em lugar nenhum do site.
- **Senha temporária:** ao criar um usuário, o admin escolhe a senha inicial dele. Recomenda-se repassar essa senha por um canal seguro e pedir para a pessoa trocá-la depois (link "Esqueci minha senha" na tela de login).
- **Exclusão de registros:** só admins podem excluir. Não há "lixeira" — a exclusão é definitiva.
- **"Chamados resolvidos" na Supervisão:** cada chamado agora guarda a data em que foi marcado como Resolvido (campo `resolvidoEm`), e é essa data que a Supervisão usa. Se o chamado for reaberto, a data é limpa e volta a ser registrada quando ele for resolvido de novo. Chamados resolvidos antes desta versão continuam usando a data da última atualização.
- **Excluir máquina:** apaga também o histórico de manutenções dela (o Firestore não faz isso sozinho).
- **Personalização:** cores, textos e nome da empresa ficam em `css/style.css` e nos arquivos `.html` — fique à vontade para ajustar.

## Identidade visual

O site já usa a marca da Comm:

- **Cores**: amarelo `#F8B408` (cor de destaque — botões, abas ativas, item de menu ativo) e preto `#000000` (textos fortes e a logo). Estão definidas no topo do arquivo `css/style.css`, nas variáveis `--cor-primaria` e `--cor-marca-preta` — para trocar o tom, basta editar esses valores ali, o resto do site se ajusta sozinho.
- **Logo principal**: `assets/logo-comm.png` (versão escura, para fundos claros), usada no cabeçalho de todas as páginas internas. A tela de login usa a versão branca, `assets/logo-comm-branco.png`, dentro da barra preta no topo.
- **Logo secundária (selo do setor)**: aparece como uma etiqueta "TECNOLOGIA DA INFORMAÇÃO" ao lado da logo principal no cabeçalho de cada página interna, e como o texto "Ferramentas TI • Help Desk Matriz" na barra preta da tela de login.

Se um dia trocar de logo, basta substituir os arquivos `assets/logo-comm.png`, `assets/logo-comm-branco.png` e `assets/logo-ti.png` por versões novas (mantendo os mesmos nomes de arquivo) que o site inteiro atualiza automaticamente. Se a nova logo já vier em uma versão branca própria, use-a no lugar de gerar uma automaticamente.

## Precisa de mais alguma funcionalidade?

Este é o ponto de partida. Coisas comuns para evoluir depois: comentários/histórico dentro de cada chamado, anexos de arquivos e notas fiscais, notificações por e-mail (ex: estoque baixo), exportar relatórios em Excel, categorias de chamados (rede, hardware, software, acessos), SLA/prazo por prioridade, QR code de patrimônio para identificar máquinas rapidamente. É só pedir.
