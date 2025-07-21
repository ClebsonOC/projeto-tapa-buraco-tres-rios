// public/js/auth.js
document.addEventListener('DOMContentLoaded', function() {
    const loggedInUser = localStorage.getItem('loggedInUser');
    const userRole = localStorage.getItem('userRole');
    const currentPage = window.location.pathname;

    // 1. VERIFICA SE ESTÁ LOGADO E SE OS DADOS DE SESSÃO SÃO VÁLIDOS
    // Se não tiver usuário ou a função (role), força o login para garantir consistência.
    if ((!loggedInUser || !userRole) && currentPage !== '/login.html') {
        localStorage.removeItem('loggedInUser');
        localStorage.removeItem('userRole');
        window.location.href = '/login.html';
        return;
    }

    // 2. LÓGICA DE REDIRECIONAMENTO E PROTEÇÃO DE PÁGINA
    if (loggedInUser) {
        if (userRole === 'admin' && currentPage !== '/admin.html' && currentPage !== '/login.html') {
            window.location.href = '/admin.html';
            return;
        }
        if (userRole !== 'admin' && currentPage === '/admin.html') {
            window.location.href = '/index.html';
            return;
        }
    }

    // 3. ATUALIZA A INTERFACE (NOME E BOTÃO DE SAIR)
    const userDisplay = document.getElementById('user-display-name');
    if (userDisplay) {
        userDisplay.textContent = loggedInUser;
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            localStorage.removeItem('loggedInUser');
            localStorage.removeItem('userRole');
            window.location.href = '/login.html';
        });
    }

    // 4. MONTA O MENU DE NAVEGAÇÃO CORRETO
    const navLinksContainer = document.querySelector('.nav-links');
    if (navLinksContainer) {
        navLinksContainer.innerHTML = ''; 

        if (userRole === 'admin') {
            navLinksContainer.innerHTML = `<a href="/admin.html">Administração</a>`;
        } else {
            navLinksContainer.innerHTML = `
                <a href="/index.html">Novo Registro</a>
                <a href="/relatorio.html">Relatórios</a>
                <a href="/efetivo.html">Efetivo</a>
            `;
        }
    }
    
    // 5. LÓGICA DO MENU HAMBURGER (MOBILE)
    const navToggle = document.querySelector('.nav-toggle');
    if (navToggle && navLinksContainer) {
        navToggle.addEventListener('click', () => {
            navLinksContainer.classList.toggle('active');
        });
    }

    // 6. MARCA O LINK ATIVO NO MENU
    const navLinksList = navLinksContainer.querySelectorAll('a');
    navLinksList.forEach(link => {
        const linkPath = new URL(link.href).pathname;
        if (linkPath === currentPage) {
            link.classList.add('active');
        }
    });
});
