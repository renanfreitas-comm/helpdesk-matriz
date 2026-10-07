# Help Desk Matriz

Plataforma web para gerenciamento das atividades do time de Help Desk. Permite abrir e acompanhar chamados, atribuir responsáveis, registrar relatórios diários de atividades, manter a configuração das máquinas do parque de TI, controlar o estoque de peças/periféricos, acompanhar indicadores em um dashboard e supervisionar a produtividade do time — com papéis de Técnico e Supervisor/Admin.

## Como o projeto funciona

- O **site** (HTML, CSS, JS) é hospedado gratuitamente pelo **GitHub Pages**.
- Os **dados**, o **login** e os **laudos** das visitas ficam no **Supabase** (plano gratuito). O Supabase é um banco de dados PostgreSQL com login e armazenamento de arquivos prontos.
- Os **e-mails automáticos** saem por um **Google Apps Script** gratuito.
- Não é preciso manter nenhum servidor. O navegador conversa direto com o Supabase, e quem protege os dados são as **regras de acesso do banco** (RLS), não o site.

Estrutura de arquivos:

```
helpdesk-matriz/
├── index.html / dashboard.html / chamados.html / relatorios.html
├── visitas.html / maquinas.html / estoque.html
├── usuarios.html / supervisao.html     # somente admin
├── redefinir-senha.html                # "Esqueci minha senha" e "Trocar senha"
├── css/style.css
├── assets/                             # logos
├── js/
│   ├── supabase-config.js   # URL e chave pública do Supabase (você vai editar)
│   ├── db.js                # acesso ao banco, compartilhado pelas telas
│   ├── auth.js              # login, proteção de páginas, funções de admin
│   ├── apps-script-config.js
│   └── (uma .js por tela)
├── supabase/
│   ├── schema.sql                        # tabelas, regras de acesso, gatilhos, Storage
│   └── functions/admin-usuarios/index.ts # criar/excluir usuários e trocar senhas (servidor)
├── apps-script/Codigo.gs                 # envio de e-mails (script.google.com)
└── migracao/                             # cópia única dos dados do Firebase
```

### O que cada módulo faz

- **Chamados**: abertura e acompanhamento dos chamados de suporte. Ao criar um chamado, o técnico preenche número do chamado, área atendida e atividade realizada; prioridade, responsável e status continuam disponíveis para organização e para os indicadores do dashboard.
- **Relatórios**: cada técnico monta o relatório diário de atividades como uma pequena tabela (igual ao modelo em papel/planilha usado pela equipe): para cada linha, informa categoria, atividade, quantidade/área e status (Concluído, Em andamento ou Pendente), podendo adicionar quantas linhas quiser com o botão "+ Adicionar atividade". Um campo de resumo no final é opcional. Cada um vê o próprio histórico.
- **Máquinas**: cadastro do parque de máquinas (nome/patrimônio, setor, usuário responsável, status) com especificações técnicas (SO, processador, RAM, armazenamento, IP) e um histórico de manutenções por máquina — toda vez que alguém mexe numa máquina, registra ali.
- **Estoque**: controle dos equipamentos que passam pela TI (chegada, configuração e saída), no mesmo formato da planilha usada pela equipe — cada item registra equipamento, S/N, ativo, data de chegada, delegação, prioridade, data de saída, técnico responsável, loja/setor e situação (Recebido, Em configuração, Aguardando peça, Concluído ou Entregue). Não há controle de quantidade/estoque mínimo nesta versão — é um registro individual por equipamento.
- **Usuários** (somente admin): não existe cadastro público — só um admin cria novas contas por aqui (nome, e-mail, senha temporária e papel), além de promover/rebaixar técnicos e admins.
- **Supervisão** (somente admin): visão consolidada dos relatórios diários de todo o time (com a mesma tabela de atividades), filtrável por técnico e por período, com um resumo de produtividade (chamados resolvidos + relatórios enviados) por pessoa.

### O que o banco garante sozinho

- Só quem está logado **e tem perfil em `usuarios`** vê ou grava qualquer coisa. Excluir alguém em Usuários corta o acesso na hora.
- Ninguém se promove a admin. E sempre sobra pelo menos um admin: o banco recusa rebaixar ou excluir o último.
- O técnico só muda o **status** dos chamados em que é responsável. Chamados abertos por técnicos começam sempre como "Aberto" e sem responsável.
- Cada técnico só vê e edita os **próprios** relatórios. Admins veem todos.
- Visitas só podem ser editadas por quem registrou ou por um admin, e o mesmo vale para enviar ou trocar o laudo.
- "Quem criou", "quando criou/atualizou" e "quando o chamado foi resolvido" são preenchidos pelo banco e não podem ser falsificados.
- Excluir chamados, máquinas, itens de estoque e visitas: só admins. Excluir uma máquina apaga o histórico dela junto.

---

## Passo 1 — Criar o projeto no Supabase

1. Acesse [supabase.com](https://supabase.com), clique em **Start your project** e entre (pode ser com a conta do GitHub).
2. Clique em **New project**. Dê um nome (ex.: `helpdesk-matriz`) e crie uma **senha do banco** forte (guarde-a, mas o site não usa essa senha). Em **Region**, escolha **South America (São Paulo)**.
3. Aguarde 1 a 2 minutos até o projeto ficar pronto.

## Passo 2 — Criar o banco (tabelas e regras)

1. No menu lateral, abra **SQL Editor** → **New query**.
2. Abra o arquivo **`supabase/schema.sql`** deste projeto, copie **todo** o conteúdo, cole no editor e clique em **Run**.
3. Deve aparecer "Success. No rows returned". Pode rodar de novo no futuro sem perder dados (útil quando o arquivo for atualizado).

Isso cria as tabelas, as regras de acesso, o espaço de arquivos privado `laudos` (Storage) e liga o Realtime, que faz as telas se atualizarem sozinhas.

## Passo 3 — Configurar o login

1. Vá em **Authentication → Sign In / Providers** (ou **Providers**). Em **Email**, deixe ativado.
2. **Desligue "Allow new users to sign up"** (permitir cadastro). Só o admin cria contas, pela tela Usuários.
3. Ainda em Email, **desligue "Confirm email"**. As contas criadas pelo admin já nascem confirmadas.
4. Vá em **Authentication → URL Configuration**:
   - **Site URL**: o endereço do site, por exemplo `https://SEU-USUARIO.github.io/helpdesk-matriz/`
   - **Redirect URLs** → **Add URL**: `https://SEU-USUARIO.github.io/helpdesk-matriz/redefinir-senha.html`. Se for testar no seu computador, adicione também `http://localhost:8000/redefinir-senha.html`.

> **E-mails de "Esqueci minha senha":** o envio de e-mails embutido do Supabase é limitado a poucos por hora no plano gratuito. Para o dia a dia, use o botão **Nova senha** na tela Usuários: o admin define uma senha temporária e a pessoa troca depois em **Trocar senha**, no topo do site. Se quiser que o e-mail funcione sem limite, configure um SMTP próprio em **Authentication → Emails → SMTP Settings**.

## Passo 4 — Publicar a função de administração de usuários

Criar e excluir contas e trocar senhas exige uma chave secreta, que **não pode** ficar no site. Por isso essas ações rodam numa função do próprio Supabase:

1. No menu lateral, abra **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nome da função: **`admin-usuarios`** (exatamente assim).
3. Apague o código de exemplo, cole **todo** o conteúdo de `supabase/functions/admin-usuarios/index.ts` e clique em **Deploy function**.
4. Deixe a opção **Verify JWT** (ou "Enforce JWT verification") **ligada**.

Não precisa configurar chaves: o Supabase já entrega a chave secreta para a função automaticamente.

## Passo 5 — Ligar o site ao Supabase

1. Vá em **Project Settings → API** (em projetos novos, **Project Settings → Data API** e **API Keys**).
2. Copie a **Project URL** e a chave **anon / public** (às vezes chamada de *publishable key*).
3. Abra **`js/supabase-config.js`** e cole os dois valores no lugar de `COLE_AQUI_...`.

> ⚠️ Nunca coloque no site a chave **service_role** (ou *secret key*). Ela ignora todas as regras de acesso. Ela só é usada no script de migração, no seu computador.

## Passo 6 — Migrar os dados do Firebase (uma vez só)

O script em `migracao/` copia usuários, chamados, relatórios, máquinas (com histórico), estoque e visitas. Ele roda no seu computador e precisa do [Node.js](https://nodejs.org) (versão LTS).

1. **Chave do Firebase:** Console do Firebase → ⚙️ **Configurações do projeto** → **Contas de serviço** → **Gerar nova chave privada**. Salve o arquivo baixado como `migracao/chave-firebase.json`.
2. **Configuração:** dentro de `migracao/`, copie `config.exemplo.json` para `config.json` e preencha:
   - `supabaseUrl`: a Project URL.
   - `supabaseServiceRoleKey`: a chave **service_role / secret** (em Project Settings → API Keys).
3. Abra o terminal **dentro da pasta `migracao`** e rode:
   ```bash
   npm install
   node migrar.mjs
   ```
   Isso é só uma **simulação**: mostra quantos registros de cada tipo serão copiados, sem gravar nada.
4. Se os números estiverem certos, rode a cópia de verdade:
   ```bash
   node migrar.mjs --gravar
   ```
5. **Senhas:** o Firebase não exporta senhas. Cada usuário recebe uma senha temporária, listada em `migracao/senhas-temporarias.csv`. Repasse cada uma por um canal seguro (mensagem direta). A pessoa troca depois em **Trocar senha**.
6. **Apague** `senhas-temporarias.csv`, `chave-firebase.json` e `config.json` quando terminar. Eles já estão no `.gitignore`, mas não devem ficar no computador.

Observações:
- Pode rodar a migração mais de uma vez: nada é duplicado, e contas que já existem no Supabase mantêm a senha.
- Os laudos antigos continuam abrindo pelos links do Google Drive. Os laudos novos vão para o Supabase Storage.
- Se você **não** for migrar (banco do zero), crie o primeiro admin assim: **Authentication → Users → Add user → Create new user** (marque *Auto Confirm User*). Depois, no **SQL Editor**, rode (trocando nome e e-mail):
  ```sql
  insert into public.usuarios (id, nome, email, papel)
  select id, 'Seu Nome', email, 'admin' from auth.users where email = 'seu.email@commcenter.com.br';
  ```

## Passo 7 — E-mails automáticos (Google Apps Script)

1. Acesse [script.google.com](https://script.google.com) e abra o projeto existente (ou crie um).
2. Substitua o conteúdo de `Código.gs` por **todo** o conteúdo de `apps-script/Codigo.gs`.
3. No topo do arquivo, preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (os mesmos do Passo 5) e confira se `TOKEN_SECRETO` é igual ao `APPS_SCRIPT_TOKEN` de `js/apps-script-config.js`.
4. Escolha a função **`autorizar`** e clique em **Executar**. Aceite as permissões.
5. **Implantar → Gerenciar implantações → ✏️ Editar → Versão: Nova versão → Implantar.** A URL continua a mesma. Se for a primeira vez, use **Nova implantação → App da Web** (Executar como: Eu; Acesso: Qualquer pessoa) e cole a URL em `js/apps-script-config.js`.

O script confere no Supabase se quem pediu o e-mail é alguém logado do time, e só envia para endereços cadastrados em Usuários (até 30 envios por hora por pessoa).

## Passo 8 — Publicar no GitHub Pages

Com os arquivos atualizados na pasta do repositório:

```bash
git add .
git commit -m "Migração para o Supabase"
git push
```

Se o GitHub Pages ainda não estiver ativo: no repositório, **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**. Em 1 a 2 minutos o site atualiza.

## Passo 9 — Conferir

1. Entre com sua conta de admin (senha do `senhas-temporarias.csv`) e troque a senha em **Trocar senha**.
2. Confira se Chamados, Relatórios, Máquinas, Estoque e Visitas mostram os dados migrados.
3. Faça um teste com uma conta de técnico: ele não deve ver o menu Usuários/Supervisão, nem relatórios de outras pessoas.
4. Crie uma visita de teste, marque como Realizada com um PDF e confira se o laudo abre.

Depois que tudo estiver funcionando por alguns dias, o projeto no Firebase pode ser desativado.

---

## Cadastrando o restante do time

Tudo é feito pela tela **Usuários**, sem voltar ao painel do Supabase:

- **+ Novo usuário**: nome, e-mail, senha temporária e papel (Técnico ou Supervisor/Admin).
- **Nova senha**: define uma senha temporária para quem esqueceu a sua.
- **Tornar admin / Rebaixar a técnico** e **Excluir**. Excluir remove o login e o perfil; os registros que a pessoa criou continuam guardados.

## Testar no seu computador antes de publicar (opcional)

Como o projeto usa módulos JavaScript, abrir o `index.html` com duplo clique não funciona. Rode um servidor local na pasta do projeto:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`. Lembre-se de adicionar `http://localhost:8000/redefinir-senha.html` nas Redirect URLs (Passo 3).

---

## Limitações e observações

- **Plano gratuito do Supabase:** 500 MB de banco e 1 GB de arquivos (laudos), o que é bastante para um help desk interno. **Atenção:** projetos gratuitos sem nenhum acesso por 7 dias seguidos são *pausados*. Basta reativar no painel (**Restore project**), mas o site fica fora do ar até isso. Com uso diário do time isso não acontece.
- **Cadastro fechado:** só um admin cria contas. Com "Allow new users to sign up" desligado (Passo 3), ninguém se cadastra sozinho.
- **Exclusão de registros:** só admins podem excluir. Não há lixeira; a exclusão é definitiva.
- **"Chamados resolvidos" na Supervisão:** usa a data em que o chamado foi marcado como Resolvido, gravada pelo próprio banco. Se o chamado for reaberto, essa data é limpa.
- **Laudos:** ficam num espaço privado. O link gerado ao clicar vale por 5 minutos, e o link enviado por e-mail aos admins vale por 7 dias. Depois disso, é só abrir pela tela de Visitas.
- **Personalização:** cores, textos e nome da empresa ficam em `css/style.css` e nos arquivos `.html`.

## Identidade visual

O site já usa a marca da Comm:

- **Cores**: amarelo `#F8B408` (cor de destaque — botões, abas ativas, item de menu ativo) e preto `#000000` (textos fortes e a logo). Estão definidas no topo do arquivo `css/style.css`, nas variáveis `--cor-primaria` e `--cor-marca-preta` — para trocar o tom, basta editar esses valores ali, o resto do site se ajusta sozinho.
- **Logo principal**: `assets/logo-comm.png` (versão escura, para fundos claros), usada no cabeçalho de todas as páginas internas. A tela de login usa a versão branca, `assets/logo-comm-branco.png`, dentro da barra preta no topo.
- **Logo secundária (selo do setor)**: aparece como uma etiqueta "TECNOLOGIA DA INFORMAÇÃO" ao lado da logo principal no cabeçalho de cada página interna, e como o texto "Ferramentas TI • Help Desk Matriz" na barra preta da tela de login.

Se um dia trocar de logo, basta substituir os arquivos `assets/logo-comm.png`, `assets/logo-comm-branco.png` e `assets/logo-ti.png` por versões novas (mantendo os mesmos nomes de arquivo) que o site inteiro atualiza automaticamente. Se a nova logo já vier em uma versão branca própria, use-a no lugar de gerar uma automaticamente.

## Precisa de mais alguma funcionalidade?

Este é o ponto de partida. Coisas comuns para evoluir depois: comentários/histórico dentro de cada chamado, anexos de arquivos e notas fiscais, notificações por e-mail (ex: estoque baixo), exportar relatórios em Excel, categorias de chamados (rede, hardware, software, acessos), SLA/prazo por prioridade, QR code de patrimônio para identificar máquinas rapidamente. É só pedir.
