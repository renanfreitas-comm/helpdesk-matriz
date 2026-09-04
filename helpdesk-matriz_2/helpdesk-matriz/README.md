# Help Desk Matriz

Plataforma web para gerenciamento das atividades do time de Help Desk. Permite abrir e acompanhar chamados, atribuir responsáveis, registrar relatórios diários de atividades, manter a configuração das máquinas do parque de TI, controlar o estoque de peças/periféricos, acompanhar indicadores em um dashboard e supervisionar a produtividade do time — com papéis de Técnico e Supervisor/Admin.

## Como o projeto funciona

- O **site** (HTML, CSS, JS) é hospedado gratuitamente pelo **GitHub Pages**.
- Os **dados** (chamados e usuários) e o **login** ficam no **Firebase** (Google), também no plano gratuito. O GitHub Pages sozinho não guarda dados, por isso o Firebase entra como o "banco de dados" da aplicação.
- Não é necessário programar nenhum servidor: o navegador do usuário conversa direto com o Firebase.

Estrutura de arquivos:

```
helpdesk-matriz/
├── index.html            # Tela de login / criar conta
├── dashboard.html        # Indicadores (visão geral)
├── chamados.html         # Lista de chamados, criação, edição, atribuição
├── relatorios.html       # Relatórios diários de atividades (por técnico)
├── maquinas.html         # Configuração de máquinas + histórico de manutenções
├── estoque.html          # Estoque de peças/periféricos + movimentações
├── usuarios.html         # Gestão de usuários (somente admin)
├── supervisao.html       # Supervisão: relatórios do time e produtividade (somente admin)
├── css/style.css         # Estilo visual (cores da marca Comm)
├── assets/
│   ├── logo-comm.png         # Logo principal (marca da empresa)
│   └── logo-ti.png            # Logo secundária (selo do setor de TI)
├── js/
│   ├── firebase-config.js   # Credenciais do Firebase (você vai editar)
│   ├── auth.js               # Login, cadastro, proteção de páginas
│   ├── nav.js                 # Cabeçalho comum
│   ├── chamados.js
│   ├── dashboard.js
│   ├── usuarios.js
│   ├── relatorios.js
│   ├── maquinas.js
│   ├── estoque.js
│   ├── supervisao.js
│   └── index.js
└── firestore.rules       # Regras de segurança do banco (você vai colar no console do Firebase)
```

### O que cada módulo faz

- **Chamados**: abertura e acompanhamento dos chamados de suporte, com atribuição de responsável.
- **Relatórios**: cada técnico registra um resumo do que fez em cada dia, podendo vincular os chamados que atendeu naquele dia. Cada um vê o próprio histórico.
- **Máquinas**: cadastro do parque de máquinas (nome/patrimônio, setor, usuário responsável, status) com especificações técnicas (SO, processador, RAM, armazenamento, IP) e um histórico de manutenções por máquina — toda vez que alguém mexe numa máquina, registra ali.
- **Estoque**: itens de estoque (peças, cabos, periféricos) com quantidade mínima de alerta. Toda entrada (reposição) ou saída (uso) é registrada como uma movimentação, e a quantidade atual é calculada automaticamente a partir delas.
- **Usuários**: promover/rebaixar técnicos e admins (somente admin).
- **Supervisão** (somente admin): visão consolidada dos relatórios diários de todo o time, filtrável por técnico e por período, com um resumo de produtividade (chamados resolvidos + relatórios enviados) por pessoa.

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
- Só quem está logado enxerga os chamados, relatórios, máquinas, estoque e usuários.
- Técnicos só conseguem atualizar chamados dos quais são responsáveis, e só criam relatórios em seu próprio nome.
- Só admins podem excluir registros ou promover/rebaixar papéis.

### Sobre os "índices" do Firestore (importante)

As telas de **Relatórios** e **Estoque** fazem buscas que combinam um filtro com uma ordenação (por exemplo: relatórios de um técnico, ordenados por data). O Firestore exige um "índice composto" para isso funcionar, e ele **não vem criado por padrão**.

Não se preocupe em criar isso manualmente: na primeira vez que uma dessas telas rodar essa busca, vai aparecer um erro no console do navegador (tecla F12 → aba "Console") com uma frase parecida com *"The query requires an index"* e, junto, **um link azul**. Basta abrir esse link (ele já vem com tudo preenchido), clicar em **Criar índice** no Firebase e aguardar cerca de 1 minuto. Depois disso, é só recarregar a página e a tela passa a funcionar normalmente. Isso só precisa ser feito uma vez por tela.

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

## Passo 8 — Primeiro acesso

1. Acesse a URL do seu site.
2. Clique em **Criar conta** e cadastre-se com seu nome, e-mail e senha.
3. **O primeiro usuário a se cadastrar vira automaticamente Supervisor/Admin.** Os próximos se cadastram como Técnico por padrão.
4. Como admin, entre em **Usuários** e promova quem mais precisar ter acesso de supervisor.
5. Peça para o restante do time acessar o link e criar as próprias contas.

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
- **Cadastro aberto:** qualquer pessoa com o link pode criar uma conta. Para um time interno pequeno isso costuma ser aceitável, mas se quiser reforçar, é possível depois trocar por links de convite ou aprovação manual — posso te ajudar a implementar isso quando precisar.
- **Exclusão de registros:** só admins podem excluir. Não há "lixeira" — a exclusão é definitiva.
- **"Chamados resolvidos" na Supervisão:** a contagem usa a data da última atualização do chamado. Se um chamado for reaberto e editado depois de resolvido, a data considerada é a da edição mais recente — é uma aproximação razoável para o dia a dia, mas não um registro imutável de "quando foi resolvido".
- **Personalização:** cores, textos e nome da empresa ficam em `css/style.css` e nos arquivos `.html` — fique à vontade para ajustar.

## Identidade visual

O site já usa a marca da Comm:

- **Cores**: amarelo `#F8B408` (cor de destaque — botões, abas ativas, item de menu ativo) e preto `#000000` (textos fortes e a logo). Estão definidas no topo do arquivo `css/style.css`, nas variáveis `--cor-primaria` e `--cor-marca-preta` — para trocar o tom, basta editar esses valores ali, o resto do site se ajusta sozinho.
- **Logo principal**: `assets/logo-comm.png`, usada no cabeçalho de todas as páginas internas e em destaque na tela de login.
- **Logo secundária (selo do setor)**: aparece como uma etiqueta "TECNOLOGIA DA INFORMAÇÃO" ao lado da logo principal no cabeçalho, e como a imagem `assets/logo-ti.png` em destaque na tela de login — identificando que o sistema é do setor de TI dentro da Comm.

Se um dia trocar de logo, basta substituir os arquivos `assets/logo-comm.png` e `assets/logo-ti.png` por versões novas (mantendo os mesmos nomes de arquivo) que o site inteiro atualiza automaticamente.

## Precisa de mais alguma funcionalidade?

Este é o ponto de partida. Coisas comuns para evoluir depois: comentários/histórico dentro de cada chamado, anexos de arquivos e notas fiscais, notificações por e-mail (ex: estoque baixo), exportar relatórios em Excel, categorias de chamados (rede, hardware, software, acessos), SLA/prazo por prioridade, QR code de patrimônio para identificar máquinas rapidamente. É só pedir.
