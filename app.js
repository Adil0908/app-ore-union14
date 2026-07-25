/**
 * UNION14 - SISTEMA DI GESTIONE ORE LAVORATIVE
 * Versione 2.0 - PocketBase
 */

// ============================================================
// 1. CONFIGURAZIONI
// ============================================================

const CONFIG = {
    TARIFFA_ORARIA: 28.50,
    COSTO_ORARIO_NON_CONFORMITA: 28.50,
    RIGHE_PER_PAGINA: 10,
    ELEMENTI_GRAFICI_PER_PAGINA: 15,
    PAUSA_INIZIO: "12:00",
    PAUSA_FINE: "13:00",
    CACHE_TTL: 300000,
    MESI: ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
           "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"],
    MESI_ABBREVIATI: ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", 
                      "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]
};

const ADMIN_CREDENTIALS = {
    email: 'eliraoui.a@union14.it',
    password: 'Eliraoui0101!'
};

// ============================================================
// 2. UTILITY
// ============================================================

const Utils = {
    calcolaOreLavorate(oraInizio, oraFine) {
        if (!oraInizio || !oraFine) return 0;
        
        const normalizza = (ora) => {
            if (!ora || typeof ora !== 'string') return null;
            ora = ora.trim();
            if (ora === '') return null;
            if (ora === "24:00" || ora === "24:00:00") return "23:59";
            
            const pattern = /^([0-1][0-9]|2[0-3]):([0-5][0-9])$/;
            if (pattern.test(ora)) return ora;
            
            const corto = /^([0-9]):([0-5][0-9])$/;
            if (corto.test(ora)) return '0' + ora;
            
            const solo = /^([0-9]|1[0-9]|2[0-3])$/;
            if (solo.test(ora)) return `${ora.padStart(2, '0')}:00`;
            
            return null;
        };
        
        const inizio = normalizza(oraInizio);
        const fine = normalizza(oraFine);
        if (!inizio || !fine) return 0;
        
        const toMin = (t) => {
            const [o, m] = t.split(':').map(Number);
            return o * 60 + m;
        };
        
        let diff = toMin(fine) - toMin(inizio);
        if (diff < 0) diff += 24 * 60;
        return Math.round((diff / 60) * 100) / 100;
    },

    formattaOreDecimali(ore) {
        if (isNaN(ore) || ore < 0) return "0:00";
        const o = Math.floor(ore);
        const m = Math.round((ore - o) * 60);
        return `${o}:${String(m).padStart(2, '0')}`;
    },

    siSovrappongono(i1, f1, i2, f2) {
        const toMin = (t) => {
            const [o, m] = t.split(':').map(Number);
            return o * 60 + m;
        };
        return toMin(i1) < toMin(f2) && toMin(f1) > toMin(i2);
    },

    arrotondaAlQuartoDora(ora) {
        if (!ora || !/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(ora)) return ora;
        const [ore, min] = ora.split(":").map(Number);
        const arrot = Math.round(min / 15) * 15;
        const oF = ore + Math.floor(arrot / 60);
        const mF = arrot % 60;
        return `${String(oF).padStart(2, "0")}:${String(mF).padStart(2, "0")}`;
    },

   formattaDataItaliana(dataString) {
    if (!dataString) return 'N/D';
    try {
        // 🔥 SE LA DATA CONTIENE 'T', PRENDI SOLO LA PARTE PRIMA
        let dataPulita = dataString;
        if (dataString.includes('T')) {
            dataPulita = dataString.split('T')[0];
        }
        const data = new Date(dataPulita + 'T00:00:00');
        if (isNaN(data.getTime())) return 'N/D';
        const mesi = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        return `${data.getDate()} ${mesi[data.getMonth()]} ${data.getFullYear()}`;
    } catch { return 'N/D'; }
},

    escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    async hashPassword(password) {
        // PocketBase gestisce le password automaticamente
        return password;
    }
};

// ============================================================
// 3. STATE MANAGER
// ============================================================

class StateManager {
    constructor() {
        this.currentUser = null;
        this.cache = new Map();
        this.datiFiltrati = null;
        this.datiTotali = { commesse: [], dipendenti: [], oreLavorate: [], fornitori: [] };
        this.paginazione = { commesse: 1, dipendenti: 1, oreLavorate: 1, fornitori: 1 };
        this.filtri = { margini: { anno: '', mese: '' }, oreDipendenti: { anno: '', mese: '' } };
        this.pagineGrafici = { margini: 1, oreDipendenti: 1 };
        this.tuttiMargini = [];
        this.tutteOreDipendenti = [];
        this.aggiornamentoInCorso = false;
        this.salvataggioInCorso = false;
    }

    setCache(key, data, ttl = CONFIG.CACHE_TTL) {
        this.cache.set(key, { data, timestamp: Date.now(), ttl });
    }

    getCache(key) {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() - item.timestamp > item.ttl) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    clearCache() { this.cache.clear(); }
}

const stateManager = new StateManager();

// ============================================================
// 4. NOTIFICATION SERVICE
// ============================================================

const NotificationService = {
    show(message, type = 'info', duration = 5000) {
        const existing = document.querySelectorAll('.notification-toast');
        existing.forEach(n => n.remove());

        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const colors = { success: '#16a34a', error: '#dc2626', warning: '#eab308', info: '#0891b2' };

        const el = document.createElement('div');
        el.className = 'notification-toast';
        el.style.cssText = `
            position: fixed; top: 24px; right: 24px; z-index: 99999;
            background: #ffffff; border-left: 4px solid ${colors[type] || colors.info};
            border-radius: 10px; padding: 16px 20px; min-width: 320px; max-width: 480px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.15);
            display: flex; align-items: flex-start; gap: 12px;
            animation: slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            color: #0f172a; border: 1px solid #e2e8f0;
        `;

        el.innerHTML = `
            <span style="font-size:1.5rem;flex-shrink:0;">${icons[type] || 'ℹ️'}</span>
            <div style="flex:1;">
                <div style="font-weight:600;font-size:0.9rem;margin-bottom:2px;">
                    ${type.charAt(0).toUpperCase() + type.slice(1)}
                </div>
                <div style="font-size:0.875rem;color:#475569;">${message}</div>
            </div>
            <button onclick="this.parentElement.remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#94a3b8;padding:0 4px;">✕</button>
        `;

        document.body.appendChild(el);

        setTimeout(() => {
            if (el.parentElement) {
                el.style.opacity = '0';
                el.style.transform = 'translateX(100px)';
                setTimeout(() => el.remove(), 300);
            }
        }, duration);
    },
    success(msg) { this.show(msg, 'success', 4000); },
    error(msg) { this.show(msg, 'error', 6000); },
    warning(msg) { this.show(msg, 'warning', 5000); },
    info(msg) { this.show(msg, 'info', 4000); }
};

// ============================================================
// 5. PAGINATION MANAGER
// ============================================================

class PaginationManager {
    constructor(containerId, righePerPagina = CONFIG.RIGHE_PER_PAGINA) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.righePerPagina = righePerPagina;
        this.paginaCorrente = 1;
        this.datiTotali = [];
        this.callbackAggiorna = null;
        this._isRendering = false;
        
        if (!this.container) {
            console.warn(`⚠️ Container ${containerId} non trovato, creazione automatica...`);
            this.container = document.createElement('div');
            this.container.id = containerId;
            this.container.className = 'mt-3';
            
            const tableMap = {
                'paginationOre': 'orelavorateTable',
                'paginationCommesse': 'commesseTable',
                'paginationDipendenti': 'dipendentiTable',
                'paginationFornitori': 'fornitoriTable'
            };
            
            const tableId = tableMap[containerId];
            if (tableId) {
                const table = document.getElementById(tableId);
                if (table && table.parentNode) {
                    table.parentNode.insertBefore(this.container, table.nextSibling);
                    console.log(`✅ Container ${containerId} creato automaticamente`);
                }
            }
        }
    }

    render(datiTotali, callbackAggiorna) {
        if (this._isRendering) {
            console.log('⏳ Render già in corso, salto...');
            return;
        }
        this._isRendering = true;

        try {
            if (!this.container) {
                console.error(`❌ Container ${this.containerId} non trovato`);
                return;
            }
            
            this.datiTotali = datiTotali || [];
            this.callbackAggiorna = callbackAggiorna;
            
            const numPagine = Math.max(1, Math.ceil(this.datiTotali.length / this.righePerPagina));
            
            if (this.datiTotali.length === 0) {
                this.container.innerHTML = '';
                this.container.style.display = 'none';
                this._isRendering = false;
                return;
            }

            if (numPagine <= 1) {
                this.container.innerHTML = '';
                this.container.style.display = 'none';
                this._isRendering = false;
                return;
            }

            this.container.style.display = 'block';

            if (this.paginaCorrente < 1) this.paginaCorrente = 1;
            if (this.paginaCorrente > numPagine) this.paginaCorrente = numPagine;

            let html = `
                <div class="pagination-controls d-flex justify-content-center align-items-center gap-2 flex-wrap">
                    <button class="btn btn-outline-secondary btn-sm btn-pagina-prec" 
                            data-container="${this.containerId}"
                            ${this.paginaCorrente === 1 ? 'disabled' : ''}>
                        <i class="fas fa-chevron-left"></i> Prec
                    </button>
                    <div class="pagination-numbers d-flex gap-1">
            `;

            for (let i = 1; i <= numPagine; i++) {
                html += `<button class="btn btn-sm ${i === this.paginaCorrente ? 'btn-primary' : 'btn-outline-primary'} btn-pagina-numero" 
                                data-pagina="${i}"
                                data-container="${this.containerId}">${i}</button>`;
            }

            html += `
                    </div>
                    <button class="btn btn-outline-secondary btn-sm btn-pagina-succ" 
                            data-container="${this.containerId}"
                            ${this.paginaCorrente === numPagine ? 'disabled' : ''}>
                        Succ <i class="fas fa-chevron-right"></i>
                    </button>
                    <span class="pagination-info ms-2 text-muted small">
                        ${this.datiTotali.length} record - Pagina ${this.paginaCorrente} di ${numPagine}
                    </span>
                </div>
            `;

            this.container.innerHTML = html;

            const self = this;
            const container = this.container;

            const btnPrec = container.querySelector('.btn-pagina-prec');
            if (btnPrec) {
                btnPrec.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (self.paginaCorrente > 1) {
                        self.paginaCorrente--;
                        if (typeof self.callbackAggiorna === 'function') {
                            self.callbackAggiorna();
                        }
                    }
                });
            }

            const btnSucc = container.querySelector('.btn-pagina-succ');
            if (btnSucc) {
                btnSucc.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (self.paginaCorrente < numPagine) {
                        self.paginaCorrente++;
                        if (typeof self.callbackAggiorna === 'function') {
                            self.callbackAggiorna();
                        }
                    }
                });
            }

            const numeri = container.querySelectorAll('.btn-pagina-numero');
            numeri.forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const pagina = parseInt(this.dataset.pagina);
                    if (pagina !== self.paginaCorrente) {
                        self.paginaCorrente = pagina;
                        if (typeof self.callbackAggiorna === 'function') {
                            self.callbackAggiorna();
                        }
                    }
                });
            });

        } catch (error) {
            console.error(`❌ Errore render ${this.containerId}:`, error);
        } finally {
            this._isRendering = false;
        }
    }

    getDatiPagina() {
        if (!this.datiTotali || this.datiTotali.length === 0) return [];
        const inizio = (this.paginaCorrente - 1) * this.righePerPagina;
        const fine = Math.min(inizio + this.righePerPagina, this.datiTotali.length);
        return this.datiTotali.slice(inizio, fine);
    }

    aggiornaDati(nuoviDati) {
        this.datiTotali = nuoviDati || [];
        this.paginaCorrente = 1;
    }

    reset() {
        this.paginaCorrente = 1;
        this.datiTotali = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
        }
    }
}

// ============================================================
// 6. MAIN APP - CLASSE COMPLETA
// ============================================================

class OreLavorateApp {
    constructor() {
        this.pbService = pbService;
        this.paginazione = {};
        this.grafici = {};
        this.filtroTimeout = null;
        this.salvataggioInCorso = false;
        this._generazionePDFInCorso = false;
        this.init();
    }

    async init() {
        try {
            console.log('🚀 Avvio app con PocketBase...');

            if (typeof PocketBase === 'undefined') {
                console.error('❌ PocketBase SDK non caricato!');
                NotificationService.error('Errore: PocketBase SDK non caricato');
                return;
            }

            this.paginazione = {
                ore: new PaginationManager('paginationOre', CONFIG.RIGHE_PER_PAGINA),
                dipendenti: new PaginationManager('paginationDipendenti', CONFIG.RIGHE_PER_PAGINA),
                commesse: new PaginationManager('paginationCommesse', CONFIG.RIGHE_PER_PAGINA),
                fornitori: new PaginationManager('paginationFornitori', CONFIG.RIGHE_PER_PAGINA)
            };

            this.setupEventListeners();
            this.setupVisualizzazioneFasce();
            this.inizializzaDarkMode();
            this.popolaSelectMesi();

            await this.verificaSessione();

            console.log('✅ App inizializzata con successo con PocketBase');

        } catch (error) {
            console.error('❌ Errore:', error);
            NotificationService.error('Errore durante l\'inizializzazione: ' + error.message);
        }
    }

    // ============================================================
    // 7.1 SESSIONE
    // ============================================================

    async verificaSessione() {
        const saved = localStorage.getItem('union14_user');
        if (saved) {
            try {
                stateManager.currentUser = JSON.parse(saved);
                await this.mostraApplicazione();
                return;
            } catch { localStorage.removeItem('union14_user'); }
        }
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('appContent').style.display = 'none';
    }

   async gestisciLogin() {
    try {
        const email = document.getElementById('inputEmail').value.trim();
        const password = document.getElementById('inputPassword').value.trim();

        if (!email || !password) {
            NotificationService.error('Inserisci email e password');
            return;
        }

        // 🔥 LOGIN ADMIN (credentiali fisse)
        if (email === ADMIN_CREDENTIALS.email && password === ADMIN_CREDENTIALS.password) {
            stateManager.currentUser = { 
                ruolo: 'admin', 
                name: 'Amministratore', 
                email: ADMIN_CREDENTIALS.email 
            };
            localStorage.setItem('union14_user', JSON.stringify(stateManager.currentUser));
            await this.mostraApplicazione();
            return;
        }

        // 🔥 LOGIN DIPENDENTE (via PocketBase)
        try {
            const authData = await this.pbService.login(email, password);
            
            // 🔥 CERCA IL DIPENDENTE NELLA COLLECTION 'dipendenti'
            const dipendenti = await this.pbService.getCollection('dipendenti');
            console.log('📋 Tutti i dipendenti:', dipendenti);
            
            const dip = dipendenti.find(d => d.email === email);
            console.log('🔍 Dipendente trovato:', dip);
            
            if (dip) {
                // 🔥 USA IL RUOLO SALVATO NEL DATABASE
                const ruolo = dip.ruolo || 'dipendente';
                console.log('📌 Ruolo assegnato:', ruolo);
                
                stateManager.currentUser = {
                    ruolo: ruolo,
                    name: `${dip.nome} ${dip.cognome}`,
                    email: dip.email,
                    id: dip.id,
                    userId: dip.userId || dip.id
                };
            } else {
                // 🔥 SE NON TROVA IL DIPENDENTE, USA I DATI DI AUTH
                console.warn('⚠️ Dipendente non trovato in collection "dipendenti", uso dati auth');
                stateManager.currentUser = {
                    ruolo: 'dipendente',
                    name: authData.record?.name || 'Utente',
                    email: authData.record?.email || email,
                    id: authData.record?.id
                };
            }
            
            console.log('✅ Utente loggato:', stateManager.currentUser);
            localStorage.setItem('union14_user', JSON.stringify(stateManager.currentUser));
            await this.mostraApplicazione();
            
        } catch (authError) {
            console.error('❌ Errore autenticazione:', authError);
            NotificationService.error('Credenziali non valide');
        }

        document.getElementById('inputEmail').value = '';
        document.getElementById('inputPassword').value = '';

    } catch (error) {
        console.error('❌ Errore login:', error);
        NotificationService.error('Errore durante il login');
    }
}

    logout() {
        stateManager.currentUser = null;
        stateManager.clearCache();
        localStorage.removeItem('union14_user');
        this.pbService.logout();
        document.getElementById('loginPage').style.display = 'flex';
        document.getElementById('appContent').style.display = 'none';
        NotificationService.info('Logout effettuato');
    }

    // ============================================================
    // 7.2 MOSTRA APPLICAZIONE
    // ============================================================

async mostraApplicazione() {
    try {
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('appContent').style.display = 'block';

        // 🔥 PRENDI IL RUOLO DALLO STATE
        const isAdmin = stateManager.currentUser?.ruolo === 'admin';
        
        console.log('👤 Utente corrente:', stateManager.currentUser);
        console.log('🔑 È admin?', isAdmin);
        
        document.body.setAttribute('data-user-role', isAdmin ? 'admin' : 'dipendente');
        
        // NASCONDI TUTTE LE SEZIONI
        document.querySelectorAll('.admin-only, .dipendente-only').forEach(el => {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            el.style.height = '0';
            el.style.overflow = 'hidden';
            el.style.padding = '0';
            el.style.margin = '0';
            el.removeAttribute('data-user-role');
        });
        
        if (isAdmin) {
            // 🔥 MOSTRA SOLO SEZIONI ADMIN
            console.log('🟢 Mostro sezioni Admin');
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
                el.style.height = 'auto';
                el.style.overflow = 'visible';
                el.style.padding = '';
                el.style.margin = '';
                el.setAttribute('data-user-role', 'admin');
            });
            
            // NASCONDI SEZIONE DIPENDENTI
            const sezioneDipendenti = document.querySelector('.dipendente-only');
            if (sezioneDipendenti) {
                sezioneDipendenti.style.display = 'none';
                sezioneDipendenti.style.visibility = 'hidden';
                sezioneDipendenti.style.opacity = '0';
                sezioneDipendenti.style.pointerEvents = 'none';
                sezioneDipendenti.style.height = '0';
                sezioneDipendenti.style.overflow = 'hidden';
                sezioneDipendenti.style.padding = '0';
                sezioneDipendenti.style.margin = '0';
            }
            
            // NASCONDI FORM ORE
            const oreForm = document.getElementById('oreForm');
            if (oreForm) {
                oreForm.style.display = 'none';
                oreForm.style.visibility = 'hidden';
                oreForm.style.opacity = '0';
                oreForm.style.pointerEvents = 'none';
                oreForm.style.height = '0';
                oreForm.style.overflow = 'hidden';
                oreForm.style.padding = '0';
                oreForm.style.margin = '0';
            }
            
        } else {
            // 🔥 MOSTRA SOLO SEZIONI DIPENDENTI
            console.log('🟢 Mostro sezioni Dipendente');
            document.querySelectorAll('.dipendente-only').forEach(el => {
                el.style.display = 'block';
                el.style.visibility = 'visible';
                el.style.opacity = '1';
                el.style.pointerEvents = 'auto';
                el.style.height = 'auto';
                el.style.overflow = 'visible';
                el.style.padding = '';
                el.style.margin = '';
                el.setAttribute('data-user-role', 'dipendente');
            });
            
            // NASCONDI SEZIONI ADMIN
            document.querySelectorAll('.admin-only').forEach(el => {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
                el.style.opacity = '0';
                el.style.pointerEvents = 'none';
                el.style.height = '0';
                el.style.overflow = 'hidden';
                el.style.padding = '0';
                el.style.margin = '0';
                el.setAttribute('data-user-role', 'dipendente');
            });
            
            // MOSTRA FORM ORE
            const oreForm = document.getElementById('oreForm');
            if (oreForm) {
                oreForm.style.display = 'flex';
                oreForm.style.flexWrap = 'wrap';
                oreForm.style.gap = '1rem';
                oreForm.style.visibility = 'visible';
                oreForm.style.opacity = '1';
                oreForm.style.pointerEvents = 'auto';
                oreForm.style.height = 'auto';
                oreForm.style.overflow = 'visible';
                oreForm.style.padding = '';
                oreForm.style.margin = '';
            }
            // 🔥 AGGIUNGI QUESTE RIGHE PER MOSTRARE LE FASCE ORARIE
    const fasceContainer = document.getElementById('visualizzazioneFasce');
    if (fasceContainer) {
        fasceContainer.style.display = 'block';
        fasceContainer.style.visibility = 'visible';
        fasceContainer.style.opacity = '1';
        fasceContainer.style.pointerEvents = 'auto';
        fasceContainer.style.height = 'auto';
        fasceContainer.style.overflow = 'visible';
        fasceContainer.style.padding = '';
        fasceContainer.style.margin = '';
        console.log('✅ Fasce orarie rese visibili');
    }

    // Nascondi skeleton del form ore
    const skeleton = document.getElementById('oreFormSkeleton');
    if (skeleton) {
        skeleton.style.display = 'none';
    }
        }

        // AGGIORNA UI HEADER
        const roleBadge = document.getElementById('userRoleBadge');
        const userName = document.getElementById('userNameDisplay');
        
        if (roleBadge) {
            roleBadge.textContent = isAdmin ? 'Admin' : 'Dipendente';
            roleBadge.className = `badge ${isAdmin ? 'bg-danger' : 'bg-primary'}`;
        }
        if (userName) {
            userName.textContent = `👤 ${stateManager.currentUser?.name || 'Utente'}`;
        }

        // CARICA DATI PER ADMIN
        if (isAdmin) {
            this.popolaAnniMonitor();
            this.popolaAnniFiltriGrafici();
            this.mostraMessaggioMonitoraggioVuoto();
            
            await Promise.all([
                this.aggiornaTabellaCommesse(),
                this.aggiornaTabellaDipendenti(),
                this.aggiornaTabellaOreLavorate(),
                this.caricaFornitori()
            ]);

            setTimeout(() => {
                if (typeof Chart !== 'undefined') {
                    this.creaGraficiDashboard();
                }
                this.aggiornaInfoUltimoBackup();
            }, 500);
            
            const oggi = new Date().toISOString().split('T')[0];
            this.filtraOrePerGiorno(oggi);
        }

        // AGGIORNA MENU COMMESSE PER TUTTI
        await this.aggiornaMenuCommesse();
        
        const oggi = new Date().toISOString().split('T')[0];
        const dataInput = document.getElementById('oreData');
        if (dataInput) {
            dataInput.value = oggi;
        }

        if (!isAdmin) {
            await this.aggiornaVisualizzazioneFasce(oggi);
        }

        NotificationService.success(`Benvenuto, ${stateManager.currentUser?.name || 'Utente'}!`);
        
    } catch (error) {
        console.error('❌ Errore mostraApplicazione:', error);
        NotificationService.error('Errore durante il caricamento');
    }
}

    mostraMessaggioMonitoraggioVuoto() {
        const tbody = document.querySelector('#monitorCommesseTable tbody');
        if (!tbody) return;
        
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center py-5">
                    <div class="py-4">
                        <i class="fas fa-search fa-3x mb-3 text-muted"></i>
                        <h5>Nessuna commessa caricata</h5>
                        <p class="text-muted">Utilizza i filtri sopra per caricare i dati</p>
                        <button class="btn btn-primary btn-sm" onclick="app.aggiornaMonitorCommesse()">
                            <i class="fas fa-sync-alt"></i> Carica Monitoraggio
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    popolaGiorni() {
        const mese = document.getElementById('filtroMese')?.value;
        const anno = document.getElementById('filtroAnno')?.value;
        const giornoSelect = document.getElementById('filtroGiorno');
        
        if (!giornoSelect) return;
        
        const valoreCorrente = giornoSelect.value;
        giornoSelect.innerHTML = '<option value="">Tutti i giorni</option>';
        
        if (mese && anno) {
            const giorniNelMese = new Date(parseInt(anno), parseInt(mese), 0).getDate();
            
            for (let i = 1; i <= giorniNelMese; i++) {
                const option = document.createElement('option');
                option.value = String(i).padStart(2, '0');
                option.textContent = i;
                giornoSelect.appendChild(option);
            }
            
            if (valoreCorrente && giornoSelect.querySelector(`option[value="${valoreCorrente}"]`)) {
                giornoSelect.value = valoreCorrente;
            }
        }
    }

    mostraFormOre() {
        try {
            const container = document.querySelector('.dipendente-only');
            if (container) {
                container.style.display = 'block';
                container.style.visibility = 'visible';
                container.style.opacity = '1';
            }
            
            const form = document.getElementById('oreForm');
            if (form) {
                form.style.display = 'flex';
                form.style.flexWrap = 'wrap';
                form.style.gap = '1rem';
                form.style.visibility = 'visible';
                form.style.opacity = '1';
            }
            
            const skeleton = document.getElementById('oreFormSkeleton');
            if (skeleton) {
                skeleton.style.display = 'none';
            }
            
            this.aggiornaMenuCommesse();
            
            console.log('✅ Form ore mostrato con successo');
            return true;
        } catch (error) {
            console.error('Errore mostraFormOre:', error);
            return false;
        }
    }

    // ============================================================
    // 7.3 EVENT LISTENERS
    // ============================================================

    setupEventListeners() {
        console.log('🔄 Setup event listeners...');

        // Login
        const btnLogin = document.getElementById('btnLogin');
        if (btnLogin) {
            btnLogin.addEventListener('click', () => this.gestisciLogin());
        }

        const inputPassword = document.getElementById('inputPassword');
        if (inputPassword) {
            inputPassword.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') this.gestisciLogin();
            });
        }

        // Logout
        const logoutBtn = document.getElementById('logoutButton');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // Form Ore
        const oreForm = document.getElementById('oreForm');
        if (oreForm) {
            oreForm.addEventListener('submit', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handleOreForm(e);
            });
        }

        // Form Commessa
        const commessaForm = document.getElementById('commessaForm');
        if (commessaForm) {
    // 🔥 RIMUOVI EVENTI PRECEDENTI
    const newCommessaForm = commessaForm.cloneNode(true);
    commessaForm.parentNode.replaceChild(newCommessaForm, commessaForm);
    
    // 🔥 AGGIUNGI UN SOLO LISTENER
    newCommessaForm.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.handleCommessaForm(e);
    });
}

        // Form Dipendenti
        const dipendentiForm = document.getElementById('dipendentiForm');
        if (dipendentiForm) {
            dipendentiForm.addEventListener('submit', (e) => this.handleDipendentiForm(e));
        }

        // Form Fornitori
        const fornitoreForm = document.getElementById('fornitoreForm');
        if (fornitoreForm) {
            fornitoreForm.addEventListener('submit', (e) => this.aggiungiLavorazioneFornitore(e));
        }

        // Filtri Ore
        const filtraOre = document.getElementById('filtraOreLavorate');
        if (filtraOre) {
            filtraOre.addEventListener('submit', (e) => {
                e.preventDefault();
                this.applicaFiltriOre();
            });
        }

        // Reset Filtri
        const btnResetFiltri = document.getElementById('btnResetFiltri');
        if (btnResetFiltri) {
            btnResetFiltri.addEventListener('click', () => this.resetFiltriOre());
        }

        // Mostra Tutti
        const btnMostraTutti = document.getElementById('btnMostraTutti');
        if (btnMostraTutti) {
            btnMostraTutti.addEventListener('click', () => this.mostraTuttiOre());
        }

        // PDF
        const btnPDF = document.getElementById('btnScaricaPDF');
        if (btnPDF) {
            btnPDF.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                if (this.disabled) return;
                
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generazione...';
                
                if (app && typeof app.generaPDFFiltrato === 'function') {
                    app.generaPDFFiltrato().finally(() => {
                        this.disabled = false;
                        this.innerHTML = '<i class="fas fa-file-pdf"></i> Scarica PDF (come visualizzato)';
                    });
                } else {
                    this.disabled = false;
                    this.innerHTML = '<i class="fas fa-file-pdf"></i> Scarica PDF (come visualizzato)';
                    NotificationService.error('Funzione PDF non disponibile');
                }
            });
        }

        // Monitoraggio
        const btnAggiornaMonitor = document.getElementById('btnAggiornaMonitor');
        if (btnAggiornaMonitor) {
            btnAggiornaMonitor.addEventListener('click', () => this.aggiornaMonitorCommesse());
        }

        const btnResetFiltriMonitor = document.getElementById('btnResetFiltriMonitor');
        if (btnResetFiltriMonitor) {
            btnResetFiltriMonitor.addEventListener('click', () => this.resetFiltriMonitor());
        }

        const btnScaricaPDFMonitor = document.getElementById('btnScaricaPDFMonitor');
        if (btnScaricaPDFMonitor) {
            btnScaricaPDFMonitor.addEventListener('click', () => this.generaPDFMonitoraggio());
        }

        // Filtri Monitoraggio
        const filtroNome = document.getElementById('filtroNomeCommessa');
        if (filtroNome) {
            filtroNome.addEventListener('input', () => {
                clearTimeout(this.filtroTimeout);
                this.filtroTimeout = setTimeout(() => this.aggiornaMonitorCommesse(), 400);
            });
        }

        const filtroCommessaMonitor = document.getElementById('filtroCommessaMonitor');
        if (filtroCommessaMonitor) {
            filtroCommessaMonitor.addEventListener('change', () => this.aggiornaMonitorCommesse());
        }

        const filtroAnnoMonitor = document.getElementById('filtroAnnoMonitor');
        if (filtroAnnoMonitor) {
            filtroAnnoMonitor.addEventListener('change', () => this.aggiornaMonitorCommesse());
        }

        const filtroMeseMonitor = document.getElementById('filtroMeseMonitor');
        if (filtroMeseMonitor) {
            filtroMeseMonitor.addEventListener('change', () => this.aggiornaMonitorCommesse());
        }

        // Filtri Anno/Mese/Giorno
        const filtroAnno = document.getElementById('filtroAnno');
        if (filtroAnno) {
            filtroAnno.addEventListener('change', () => this.popolaGiorni());
        }

        const filtroMese = document.getElementById('filtroMese');
        if (filtroMese) {
            filtroMese.addEventListener('change', () => this.popolaGiorni());
        }

        // Grafici
        const btnAggiornaGrafici = document.getElementById('btnAggiornaGrafici');
        if (btnAggiornaGrafici) {
            btnAggiornaGrafici.addEventListener('click', () => this.creaGraficiDashboard());
        }

        const btnEsportaGrafici = document.getElementById('btnEsportaGrafici');
        if (btnEsportaGrafici) {
            btnEsportaGrafici.addEventListener('click', () => this.esportaGraficiPNG());
        }

        // Backup
        const btnBackupDati = document.getElementById('btnBackupDati');
        if (btnBackupDati) {
            btnBackupDati.addEventListener('click', () => this.eseguiBackupDati());
        }

        const btnRipristinoDati = document.getElementById('btnRipristinoDati');
        if (btnRipristinoDati) {
            btnRipristinoDati.addEventListener('click', () => {
                document.getElementById('fileBackupInput')?.click();
            });
        }

        const fileBackupInput = document.getElementById('fileBackupInput');
        if (fileBackupInput) {
            fileBackupInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    this.ripristinaDaBackup(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }

        // Ricerca Commesse
        const btnCercaCommessa = document.getElementById('btnCercaCommessa');
        if (btnCercaCommessa) {
            btnCercaCommessa.addEventListener('click', () => this.aggiornaTabellaCommesse());
        }

        const btnResetCercaCommessa = document.getElementById('btnResetCercaCommessa');
        if (btnResetCercaCommessa) {
            btnResetCercaCommessa.addEventListener('click', () => {
                document.getElementById('cercaCommessa').value = '';
                this.aggiornaTabellaCommesse();
            });
        }

        // Report Mensili
        const btnMostraTabella = document.getElementById('btnMostraTabella');
        if (btnMostraTabella) {
            btnMostraTabella.addEventListener('click', () => this.mostraTabellaMensile());
        }

        // PDF Rubrica
        const btnScaricaPDFDipendenti = document.getElementById('btnScaricaPDFDipendenti');
        if (btnScaricaPDFDipendenti) {
            btnScaricaPDFDipendenti.addEventListener('click', () => this.generaPDFRubricaDipendenti());
        }

        // Diagnostica
        const btnDiagnostica = document.getElementById('btnDiagnosticaCommesse');
        if (btnDiagnostica) {
            btnDiagnostica.addEventListener('click', () => this.diagnosticaCommesse());
        }

        const btnDebug = document.getElementById('btnDebugCommesse');
        if (btnDebug) {
            btnDebug.addEventListener('click', () => this.debugCommesse());
        }

        const btnTestPDF = document.getElementById('btnTestPDF');
        if (btnTestPDF) {
            btnTestPDF.addEventListener('click', () => this.testGenerazionePDF());
        }

        // Filtri Grafici
        const btnApplicaFiltriMargini = document.getElementById('btnApplicaFiltriMargini');
        if (btnApplicaFiltriMargini) {
            btnApplicaFiltriMargini.addEventListener('click', () => this.applicaFiltriMarginiGrafico());
        }

        const btnResetFiltriMargini = document.getElementById('btnResetFiltriMargini');
        if (btnResetFiltriMargini) {
            btnResetFiltriMargini.addEventListener('click', () => this.resetFiltriMarginiGrafico());
        }

        const btnApplicaFiltriOreDipendenti = document.getElementById('btnApplicaFiltriOreDipendenti');
        if (btnApplicaFiltriOreDipendenti) {
            btnApplicaFiltriOreDipendenti.addEventListener('click', () => this.applicaFiltriOreDipendentiGrafico());
        }

        const btnResetFiltriOreDipendenti = document.getElementById('btnResetFiltriOreDipendenti');
        if (btnResetFiltriOreDipendenti) {
            btnResetFiltriOreDipendenti.addEventListener('click', () => this.resetFiltriOreDipendentiGrafico());
        }

        // Paginazione Grafici
        const btnPrecMargini = document.getElementById('btnPrecMargini');
        if (btnPrecMargini) {
            btnPrecMargini.addEventListener('click', () => this.paginaMarginiPrec());
        }

        const btnSuccMargini = document.getElementById('btnSuccMargini');
        if (btnSuccMargini) {
            btnSuccMargini.addEventListener('click', () => this.paginaMarginiSucc());
        }

        const btnPrecOreDipendenti = document.getElementById('btnPrecOreDipendenti');
        if (btnPrecOreDipendenti) {
            btnPrecOreDipendenti.addEventListener('click', () => this.paginaOreDipendentiPrec());
        }

        const btnSuccOreDipendenti = document.getElementById('btnSuccOreDipendenti');
        if (btnSuccOreDipendenti) {
            btnSuccOreDipendenti.addEventListener('click', () => this.paginaOreDipendentiSucc());
        }

        // Data Input Fasce Orarie
        const oreData = document.getElementById('oreData');
        if (oreData) {
            oreData.addEventListener('change', (e) => {
                this.aggiornaVisualizzazioneFasce(e.target.value);
            });
        }

        // Pausa Pranzo
        const oreInizio = document.getElementById('oreInizio');
        if (oreInizio) {
            oreInizio.addEventListener('change', () => this.controllaPausaPranzo());
        }

        const oreFine = document.getElementById('oreFine');
        if (oreFine) {
            oreFine.addEventListener('change', () => this.controllaPausaPranzo());
        }

        // Dark Mode
        const darkModeToggle = document.getElementById('darkModeToggle');
        if (darkModeToggle) {
            darkModeToggle.addEventListener('click', () => this.toggleDarkMode());
        }

        console.log('✅ Event listeners configurati con successo');
    }

    // ============================================================
    // 7.4 DARK MODE
    // ============================================================

    inizializzaDarkMode() {
        const saved = localStorage.getItem('theme');
        const system = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (saved === 'dark' || (!saved && system)) this.attivaDarkMode();
        else this.attivaLightMode();

        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) {
                e.matches ? this.attivaDarkMode() : this.attivaLightMode();
            }
        });
    }

    toggleDarkMode() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        isDark ? this.attivaLightMode() : this.attivaDarkMode();
    }

    attivaDarkMode() {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) { toggle.innerHTML = '<i class="fas fa-sun"></i>'; }
    }

    attivaLightMode() {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) { toggle.innerHTML = '<i class="fas fa-moon"></i>'; }
    }

    // ============================================================
    // 7.5 HELPER
    // ============================================================

    popolaSelectMesi() {
        const selects = document.querySelectorAll('select[id*="filtroMese"]');
        selects.forEach(select => {
            if (select.children.length <= 1) {
                select.innerHTML = '<option value="">Tutti i mesi</option>';
                CONFIG.MESI.forEach((mese, index) => {
                    const option = document.createElement('option');
                    option.value = String(index + 1).padStart(2, '0');
                    option.textContent = mese;
                    select.appendChild(option);
                });
            }
        });
        this.popolaGiorni();
    }

    popolaAnniMonitor() {
        const select = document.getElementById('filtroAnnoMonitor');
        if (!select) return;
        const anno = new Date().getFullYear();
        select.innerHTML = '<option value="">Tutti gli anni</option>';
        for (let i = anno - 5; i <= anno + 1; i++) {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = i;
            if (i === anno) opt.selected = true;
            select.appendChild(opt);
        }
    }

    popolaAnniFiltriGrafici() {
        const ids = ['filtroAnnoMargini', 'filtroAnnoOreDipendenti', 'filtroAnno'];
        const anno = new Date().getFullYear();
        ids.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            select.innerHTML = '<option value="">Tutti gli anni</option>';
            for (let i = anno - 5; i <= anno + 1; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = i;
                if (i === anno) opt.selected = true;
                select.appendChild(opt);
            }
        });
    }

    async filtraOrePerGiorno(data) {
        try {
            if (!data) {
                data = new Date().toISOString().split('T')[0];
            }
            
            document.getElementById('filtroAnno').value = data.split('-')[0];
            document.getElementById('filtroMese').value = data.split('-')[1];
            this.popolaGiorni();
            document.getElementById('filtroGiorno').value = data.split('-')[2];
            await this.applicaFiltriOre();
        } catch (error) {
            console.error('Errore filtro per giorno:', error);
        }
    }

    // ============================================================
    // 7.6 GESTIONE ORE (FORM)
    // ============================================================

    async handleOreForm(e) {
        if (this.salvataggioInCorso) {
            console.log('⚠️ Salvataggio già in corso, salto...');
            return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        this.salvataggioInCorso = true;
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';
        }

        try {
            if (!stateManager.currentUser || stateManager.currentUser.ruolo !== 'dipendente') {
                NotificationService.error('Accesso non autorizzato');
                return;
            }

            const formData = this.getOreFormData();
            if (!this.validateOreForm(formData)) return;

            const controllo = await this.controllaOrariGiornata(
                formData.data, 
                formData.oraInizio, 
                formData.oraFine
            );
            
            if (!controllo.valido) {
                NotificationService.error(controllo.errore);
                return;
            }

            await this.pbService.addDocument("oreLavorate", formData);
            NotificationService.success('Ore lavorate aggiunte con successo!');
            
            await this.aggiornaTabellaOreLavorate();
            e.target.reset();
            
            // 🔥 IMPOSTA LA DATA CORRETTAMENTE DOPO IL RESET
        const oggi = new Date().toISOString().split('T')[0];
        const dataInput = document.getElementById('oreData');
        if (dataInput) {
            dataInput.value = oggi;
        }
        await this.aggiornaVisualizzazioneFasce(oggi)

        } catch (error) {
            console.error('Errore salvataggio ore:', error);
            NotificationService.error('Errore durante il salvataggio');
        } finally {
            this.salvataggioInCorso = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Salva Ore Lavorate';
            }
        }
    }

 getOreFormData() {
    const nomeCompleto = stateManager.currentUser.name.split(' ');
    
    // 🔥 PRENDI LA DATA DIRETTAMENTE DAL CAMPO INPUT (YYYY-MM-DD)
    const dataInput = document.getElementById('oreData');
    const data = dataInput ? dataInput.value : new Date().toISOString().split('T')[0];
     
    return {
        commessa: document.getElementById('oreCommessa').value,
        nomeDipendente: nomeCompleto[0],
        cognomeDipendente: nomeCompleto.slice(1).join(' '),
        data: data, // 🔥 SALVA COME YYYY-MM-DD
        oraInizio: Utils.arrotondaAlQuartoDora(document.getElementById('oreInizio').value),
        oraFine: Utils.arrotondaAlQuartoDora(document.getElementById('oreFine').value),
        descrizione: document.getElementById('oreDescrizione').value,
        nonConformita: document.getElementById('nonConformita').checked,
        emailDipendente: stateManager.currentUser.email
    };
}

    validateOreForm(data) {
        if (!data.commessa) { NotificationService.error('Seleziona una commessa'); return false; }
        if (!data.data) { NotificationService.error('Seleziona una data'); return false; }
        if (!data.oraInizio || !data.oraFine) { NotificationService.error('Inserisci orario di inizio e fine'); return false; }
        if (data.oraFine <= data.oraInizio) { NotificationService.error('L\'ora di fine deve essere successiva all\'inizio'); return false; }
        return true;
    }

    async controllaOrariGiornata(data, nuovaOraInizio, nuovaOraFine, idEscluso = null) {
        try {
            if (nuovaOraInizio < CONFIG.PAUSA_FINE && nuovaOraFine > CONFIG.PAUSA_INIZIO) {
                return {
                    valido: false,
                    errore: `Impossibile registrare durante la pausa pranzo (${CONFIG.PAUSA_INIZIO} - ${CONFIG.PAUSA_FINE})`
                };
            }

            const oreEsistenti = await this.pbService.getCollection("oreLavorate");
            const nome = stateManager.currentUser.name.split(' ')[0];
            const cognome = stateManager.currentUser.name.split(' ').slice(1).join(' ');
            
            const oreFiltrate = oreEsistenti.filter(ore => 
                ore.data === data &&
                ore.nomeDipendente === nome &&
                ore.cognomeDipendente === cognome &&
                ore.id !== idEscluso
            );

            for (const ore of oreFiltrate) {
                if (Utils.siSovrappongono(nuovaOraInizio, nuovaOraFine, ore.oraInizio, ore.oraFine)) {
                    return {
                        valido: false,
                        errore: `Sovrapposizione con fascia esistente: ${ore.oraInizio} - ${ore.oraFine}`
                    };
                }
            }

            return { valido: true };
        } catch (error) {
            console.error('Errore controllo orari:', error);
            return { valido: false, errore: 'Errore nel controllo degli orari' };
        }
    }

    controllaPausaPranzo() {
        const inizio = document.getElementById('oreInizio')?.value;
        const fine = document.getElementById('oreFine')?.value;
        if (!inizio || !fine) return;
        
        if (inizio < CONFIG.PAUSA_FINE && fine > CONFIG.PAUSA_INIZIO) {
            NotificationService.warning(
                `Orario sovrappone la pausa pranzo (${CONFIG.PAUSA_INIZIO} - ${CONFIG.PAUSA_FINE})`
            );
        }
    }

    // ============================================================
    // 7.7 FASCE ORARIE
    // ============================================================

    setupVisualizzazioneFasce() {
        const dataInput = document.getElementById('oreData');
        if (dataInput) {
            dataInput.addEventListener('change', async () => {
                await this.aggiornaVisualizzazioneFasce(dataInput.value);
            });
        }
    }

  async aggiornaVisualizzazioneFasce(data) {
    console.log('🔄 aggiornaVisualizzazioneFasce chiamato con data:', data);
    
    const container = document.getElementById('visualizzazioneFasce');
    const fasceElement = document.getElementById('fasceOccupate');
    
    if (!container || !fasceElement || !data) {
        console.log('⚠️ Container o fasceElement non trovati');
        if (container) container.style.display = 'none';
        return;
    }
    
    try {
        // 🔥 NORMALIZZA LA DATA
        const dataNormalizzata = data; // Già in formato YYYY-MM-DD
        const oreGiornata = await this.getFasceOccupateGiornata(dataNormalizzata);
        
        console.log('📊 Ore trovate per', dataNormalizzata, ':', oreGiornata);
        
        // MOSTRA IL CONTAINER
        container.style.display = 'block';
        container.style.visibility = 'visible';
        container.style.opacity = '1';
        container.style.height = 'auto';
        container.style.overflow = 'visible';
        container.style.pointerEvents = 'auto';
        container.style.padding = '1rem';
        container.style.margin = '1rem 0';
        container.style.border = '2px solid #10b981';
        container.style.borderRadius = '8px';
        
        fasceElement.innerHTML = '';
        
        const dataFormattata = Utils.formattaDataItaliana(dataNormalizzata);
        
        if (oreGiornata.length === 0) {
            fasceElement.innerHTML = `
                <div style="padding: 10px; background: #d1fae5; border-radius: 6px; border-left: 4px solid #10b981;">
                    ✅ <strong>${dataFormattata}</strong> - Giornata libera
                </div>
            `;
            console.log('✅ Giornata libera mostrata');
            return;
        }
        
        const header = document.createElement('div');
        header.className = 'fasce-header mb-2';
        header.innerHTML = `
            <strong>${dataFormattata} - Fasce Orarie Occupate:</strong>
            <span class="badge bg-secondary">${oreGiornata.length} fascia(e)</span>
        `;
        fasceElement.appendChild(header);
        
        oreGiornata.forEach((ore, index) => {
            const oreLavorate = Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
            const div = document.createElement('div');
            div.className = 'fascia-oraria fascia-occupata';
            div.style.cssText = 'padding: 10px; margin-bottom: 6px; background: #fee2e2; border-radius: 6px; border-left: 4px solid #dc2626;';
            div.innerHTML = `
                <div class="fascia-header">
                    <span class="fascia-numero">${index + 1}</span>
                    ⏰ <strong>${ore.oraInizio} - ${ore.oraFine}</strong>
                    <span class="fascia-ore">(${Utils.formattaOreDecimali(oreLavorate)} ore)</span>
                </div>
                <div class="fascia-dettagli" style="font-size: 0.85rem; color: #475569; margin-top: 4px;">
                    <strong>Commessa:</strong> ${Utils.escapeHtml(ore.commessa)}<br>
                    <strong>Descrizione:</strong> ${Utils.escapeHtml(ore.descrizione || '-')}
                    ${ore.nonConformita ? '<br><span class="badge bg-warning text-dark">⚠️ Non Conformità</span>' : ''}
                </div>
            `;
            fasceElement.appendChild(div);
        });
        
        const totale = oreGiornata.reduce((sum, ore) => 
            sum + Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine), 0
        );
        
        const footer = document.createElement('div');
        footer.className = 'fasce-footer mt-2';
        footer.style.cssText = 'padding: 8px; background: #e2e8f0; border-radius: 6px; font-weight: bold;';
        footer.innerHTML = `<strong>Totale giornata:</strong> ${Utils.formattaOreDecimali(totale)} ore`;
        fasceElement.appendChild(footer);
        
        this.creaTimelineGiornata(oreGiornata);
        
    } catch (error) {
        console.error('❌ Errore aggiornamento fasce:', error);
        fasceElement.innerHTML = `<div class="alert alert-danger">❌ Errore nel caricamento delle fasce orarie</div>`;
    }
}

   async getFasceOccupateGiornata(data) {
    try {
        const tutteLeOre = await this.pbService.getCollection("oreLavorate");
        const nome = stateManager.currentUser.name.split(' ')[0];
        
        // 🔥 NORMALIZZA LA DATA DI CONFRONTO
        const dataNormalizzata = data; // Già in formato YYYY-MM-DD
        
        console.log('🔍 Cerco ore per data:', dataNormalizzata);
        
        const oreFiltrate = tutteLeOre.filter(ore => {
            // 🔥 NORMALIZZA LA DATA DEL RECORD
            let dataRecord = ore.data || '';
            // Se la data contiene 'T', prendi solo la parte prima
            if (dataRecord.includes('T')) {
                dataRecord = dataRecord.split('T')[0];
            }
            // Se la data contiene 'Z', rimuovila
            if (dataRecord.includes('Z')) {
                dataRecord = dataRecord.replace('Z', '');
            }
            
            const match = dataRecord === dataNormalizzata && ore.nomeDipendente === nome;
            if (match) {
                console.log('✅ Trovata corrispondenza:', ore);
            }
            return match;
        });
        
        console.log('📊 Ore filtrate:', oreFiltrate.length);
        return oreFiltrate.sort((a, b) => a.oraInizio.localeCompare(b.oraInizio));
    } catch (error) {
        console.error('❌ Errore getFasceOccupateGiornata:', error);
        return [];
    }
}

    creaTimelineGiornata(oreOccupate) {
        const container = document.getElementById('fasceOccupate');
        if (!container || oreOccupate.length === 0) return;
        
        const timelineContainer = document.createElement('div');
        timelineContainer.className = 'timeline-container mt-3';
        timelineContainer.innerHTML = '<div class="timeline-title">Timeline Giornata:</div>';
        
        const timeline = document.createElement('div');
        timeline.className = 'timeline-giornata';
        
        const pausa = document.createElement('div');
        pausa.className = 'pausa-timeline';
        pausa.title = 'Pausa Pranzo 12:00-13:00';
        timeline.appendChild(pausa);
        
        oreOccupate.forEach(ore => {
            const fascia = document.createElement('div');
            fascia.className = 'fascia-occupata-timeline';
            fascia.style.left = this.calcolaPosizioneTimeline(ore.oraInizio) + '%';
            fascia.style.width = this.calcolaLarghezzaTimeline(ore.oraInizio, ore.oraFine) + '%';
            fascia.title = `${ore.oraInizio}-${ore.oraFine}: ${ore.commessa}`;
            timeline.appendChild(fascia);
        });
        
        timelineContainer.appendChild(timeline);
        container.appendChild(timelineContainer);
    }

    calcolaPosizioneTimeline(ora) {
        const [ore, minuti] = ora.split(':').map(Number);
        const minutiTotali = ore * 60 + minuti;
        return ((minutiTotali - 360) / 840) * 100;
    }

    calcolaLarghezzaTimeline(oraInizio, oraFine) {
        const posInizio = this.calcolaPosizioneTimeline(oraInizio);
        const posFine = this.calcolaPosizioneTimeline(oraFine);
        return Math.max(posFine - posInizio, 2);
    }

    // ============================================================
    // 7.8 MENU COMMESSE
    // ============================================================

    async aggiornaMenuCommesse() {
        const select = document.getElementById('oreCommessa');
        if (!select) return;
        
        select.innerHTML = '<option value="">Seleziona una commessa</option>';

        try {
            const commesse = await this.pbService.getCollection("commesse");
            const attive = commesse
                .filter(c => c.stato === 'attiva' || !c.stato)
                .sort((a, b) => (a.nomeCommessa || '').localeCompare(b.nomeCommessa || '', 'it'));
            
            if (attive.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'Nessuna commessa attiva disponibile';
                select.appendChild(option);
                return;
            }

            attive.forEach(commessa => {
                const option = document.createElement('option');
                option.value = commessa.nomeCommessa;
                option.textContent = `${commessa.nomeCommessa} - ${commessa.cliente || 'N/D'}`;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Errore caricamento commesse:', error);
        }
    }

    // ============================================================
    // 7.9 TABELLA ORE LAVORATE
    // ============================================================

    async aggiornaTabellaOreLavorate(oreFiltrate = null) {
        const tbody = document.querySelector('#orelavorateTable tbody');
        if (!tbody) {
            console.error('❌ Tbody ore lavorate non trovato');
            return;
        }

        try {
            let dati;
            
            if (oreFiltrate !== null && Array.isArray(oreFiltrate)) {
                dati = oreFiltrate;
                stateManager.datiFiltrati = dati;
                console.log(`📦 Uso dati passati: ${dati.length} record`);
            } else {
                if (stateManager.datiFiltrati && stateManager.datiFiltrati.length > 0) {
                    dati = stateManager.datiFiltrati;
                    console.log(`📦 Uso dati filtrati salvati: ${dati.length} record`);
                } else {
                    const filtri = this.getFiltriOreAttivi();
                    
                    const hasFiltri = filtri.commessa || filtri.dipendente || 
                                     filtri.anno || filtri.mese || filtri.giorno || 
                                     filtri.nonConformita;
                    
                    if (!hasFiltri) {
                        const oggi = new Date().toISOString().split('T')[0];
                        filtri.anno = oggi.split('-')[0];
                        filtri.mese = oggi.split('-')[1];
                        filtri.giorno = oggi.split('-')[2];
                        
                        document.getElementById('filtroAnno').value = filtri.anno;
                        document.getElementById('filtroMese').value = filtri.mese;
                        this.popolaGiorni();
                        document.getElementById('filtroGiorno').value = filtri.giorno;
                    }
                    
                    dati = await this.pbService.getOreLavorateFiltrate(filtri);
                    stateManager.datiFiltrati = dati;
                    console.log(`🔄 Caricati ${dati.length} record da PocketBase`);
                }
            }

            if (dati && dati.length > 0) {
                dati.sort((a, b) => {
                    if (a.data !== b.data) {
                        return b.data.localeCompare(a.data);
                    }
                    if (a.commessa !== b.commessa) {
                        return a.commessa.localeCompare(b.commessa, 'it');
                    }
                    if (a.oraInizio !== b.oraInizio) {
                        return a.oraInizio.localeCompare(b.oraInizio);
                    }
                    const nomeA = `${a.nomeDipendente} ${a.cognomeDipendente}`;
                    const nomeB = `${b.nomeDipendente} ${b.cognomeDipendente}`;
                    return nomeA.localeCompare(nomeB, 'it');
                });
            }

            stateManager.datiTotali.oreLavorate = dati || [];
            this.paginazione.ore.datiTotali = dati || [];

            const datiPagina = this.paginazione.ore.getDatiPagina();
            
            tbody.innerHTML = '';

            if (!dati || dati.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="text-center py-4 text-muted">
                            <i class="fas fa-clock fa-3x mb-3 d-block"></i>
                            <h5>Nessuna ore lavorata trovata</h5>
                            <p class="small">Registra le tue ore usando il form sopra</p>
                        </td>
                    </tr>
                `;
            } else {
                const headerRow = document.createElement('tr');
                headerRow.style.background = 'linear-gradient(135deg, #0f172a, #1e293b)';
                headerRow.innerHTML = `
                    <td colspan="9" class="text-white text-center py-1" style="font-size: 0.8rem;">
                        <i class="fas fa-list"></i> 
                        <strong>${dati.length}</strong> record trovati 
                        <span class="mx-2">•</span> 
                        <i class="fas fa-calendar"></i> Mostrati <strong>${datiPagina.length}</strong> per pagina
                        ${stateManager.datiFiltrati ? `<span class="mx-2">•</span> <i class="fas fa-filter"></i> Filtri attivi` : ''}
                    </td>
                `;
                tbody.appendChild(headerRow);

                datiPagina.forEach((ore, index) => {
                    const oreLavorate = Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
                    const row = document.createElement('tr');
                    
                    row.style.background = index % 2 === 0 ? '#ffffff' : '#f8fafc';
                    
                    if (ore.nonConformita) {
                        row.style.borderLeft = '4px solid #eab308';
                    }
                    
                    const dataFormattata = Utils.formattaDataItaliana(ore.data);
                    
                    row.innerHTML = `
                        <td>
                            <div class="d-flex align-items-center gap-1">
                                <span class="badge ${ore.nonConformita ? 'bg-warning text-dark' : 'bg-secondary'}">
                                    ${ore.nonConformita ? '⚠️' : '✓'}
                                </span>
                                <strong>${Utils.escapeHtml(ore.commessa)}</strong>
                            </div>
                        </td>
                        <td>
                            <div class="d-flex flex-column">
                                <span class="fw-semibold">${Utils.escapeHtml(ore.nomeDipendente)} ${Utils.escapeHtml(ore.cognomeDipendente)}</span>
                                <small class="text-muted" style="font-size: 0.7rem;">${ore.emailDipendente || ''}</small>
                            </div>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-light text-dark border" style="font-size: 0.8rem;">
                                <i class="fas fa-calendar-day"></i> ${dataFormattata}
                            </span>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-primary bg-opacity-10 text-primary" style="font-size: 0.8rem;">
                                <i class="fas fa-play"></i> ${ore.oraInizio || '-'}
                            </span>
                        </td>
                        <td class="text-center">
                            <span class="badge bg-danger bg-opacity-10 text-danger" style="font-size: 0.8rem;">
                                <i class="fas fa-stop"></i> ${ore.oraFine || '-'}
                            </span>
                        </td>
                        <td>
                            <div style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" 
                                 title="${Utils.escapeHtml(ore.descrizione || '')}">
                                ${Utils.escapeHtml(ore.descrizione || '-')}
                            </div>
                        </td>
                        <td class="text-center">
                            ${ore.nonConformita ? 
                                '<span class="badge bg-warning text-dark"><i class="fas fa-exclamation-triangle"></i> Sì</span>' : 
                                '<span class="badge bg-secondary text-white"><i class="fas fa-check"></i> No</span>'}
                        </td>
                        <td class="text-center">
                            <span class="badge bg-success" style="font-size: 0.9rem; padding: 4px 12px;">
                                <i class="fas fa-clock"></i> ${Utils.formattaOreDecimali(oreLavorate)}
                            </span>
                        </td>
                        <td class="text-center">
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-outline-warning btn-modifica-ore" 
                                        data-id="${ore.id}" 
                                        title="Modifica ore">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-outline-danger btn-elimina-ore" 
                                        data-id="${ore.id}" 
                                        title="Elimina ore">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(row);

                    row.querySelector('.btn-modifica-ore')?.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.modificaOreLavorate(ore.id);
                    });
                    
                    row.querySelector('.btn-elimina-ore')?.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.eliminaOreLavorate(ore.id);
                    });
                });

                const totale = this.calcolaTotaleGenerale(dati);
                const giorniLavorati = new Set(dati.map(o => o.data)).size;
                const dipendentiUnici = new Set(dati.map(o => `${o.nomeDipendente} ${o.cognomeDipendente}`)).size;
                
                const tr = document.createElement('tr');
                tr.style.background = 'linear-gradient(135deg, #0f172a, #1e293b)';
                tr.style.color = 'white';
                tr.style.fontWeight = 'bold';
                tr.innerHTML = `
                    <td colspan="2" class="text-end">
                        <i class="fas fa-calculator"></i> <strong>TOTALI</strong>
                    </td>
                    <td class="text-center">
                        <span class="badge bg-light text-dark">
                            <i class="fas fa-calendar"></i> ${giorniLavorati} gg
                        </span>
                    </td>
                    <td colspan="2" class="text-center">
                        <span class="badge bg-light text-dark">
                            <i class="fas fa-users"></i> ${dipendentiUnici} dip.
                        </span>
                    </td>
                    <td colspan="2" class="text-center">
                        <span class="badge bg-light text-dark">
                            <i class="fas fa-file-alt"></i> ${dati.length} record
                        </span>
                    </td>
                    <td class="text-center">
                        <span class="badge bg-warning text-dark" style="font-size: 1rem; padding: 6px 16px;">
                            <i class="fas fa-clock"></i> ${Utils.formattaOreDecimali(totale)}
                        </span>
                    </td>
                    <td></td>
                `;
                tbody.appendChild(tr);
            }

            this.paginazione.ore.render(dati || [], () => {
                console.log(`🔄 Callback paginazione ore - ricarico`);
                this.aggiornaTabellaOreLavorate(stateManager.datiFiltrati);
            });

        } catch (error) {
            console.error('❌ Errore tabella ore:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center text-danger py-4">
                        <i class="fas fa-exclamation-triangle fa-2x mb-2 d-block"></i>
                        Errore nel caricamento: ${error.message}
                        <br>
                        <button class="btn btn-sm btn-primary mt-2" onclick="app.aggiornaTabellaOreLavorate()">
                            <i class="fas fa-sync-alt"></i> Riprova
                        </button>
                    </td>
                </tr>
            `;
        }
    }

    getFiltriOreAttivi() {
        return {
            commessa: document.getElementById('filtroCommessa')?.value.trim() || '',
            dipendente: document.getElementById('filtroDipendente')?.value.trim() || '',
            anno: document.getElementById('filtroAnno')?.value || '',
            mese: document.getElementById('filtroMese')?.value || '',
            giorno: document.getElementById('filtroGiorno')?.value || '',
            nonConformita: document.getElementById('filtroNonConformita')?.checked || false
        };
    }

    async applicaFiltriOre() {
        try {
            const filtri = this.getFiltriOreAttivi();
            
            if (!filtri.anno && !filtri.mese && !filtri.giorno) {
                const oggi = new Date().toISOString().split('T')[0];
                filtri.anno = oggi.split('-')[0];
                filtri.mese = oggi.split('-')[1];
                filtri.giorno = oggi.split('-')[2];
                
                document.getElementById('filtroAnno').value = filtri.anno;
                document.getElementById('filtroMese').value = filtri.mese;
                this.popolaGiorni();
                document.getElementById('filtroGiorno').value = filtri.giorno;
            }
            
            const dati = await this.pbService.getOreLavorateFiltrate(filtri);
            stateManager.datiFiltrati = dati;
            await this.ricaricaDatiOreConFiltri();
            
            NotificationService.success(`${dati.length} record trovati per ${filtri.giorno}/${filtri.mese}/${filtri.anno}`);
        } catch (error) {
            console.error('Errore filtri:', error);
            NotificationService.error('Errore nell\'applicazione dei filtri');
        }
    }

    async resetFiltriOre() {
        document.getElementById('filtroCommessa').value = '';
        document.getElementById('filtroDipendente').value = '';
        document.getElementById('filtroAnno').value = new Date().getFullYear().toString();
        document.getElementById('filtroMese').value = '';
        document.getElementById('filtroGiorno').value = '';
        document.getElementById('filtroNonConformita').checked = false;

        stateManager.datiFiltrati = null;
        const dati = await this.pbService.getCollection("oreLavorate");
        await this.aggiornaTabellaOreLavorate(dati);
        NotificationService.info('Filtri resettati');
    }

    async mostraTuttiOre() {
        stateManager.datiFiltrati = null;
        const dati = await this.pbService.getCollection("oreLavorate");
        await this.aggiornaTabellaOreLavorate(dati);
        NotificationService.info('Mostrati tutti i record');
    }

    async modificaOreLavorate(id) {
        try {
            const ore = await this.pbService.getRecord("oreLavorate", id);
            if (!ore) {
                NotificationService.error('Record non trovato');
                return;
            }

            const nuovaCommessa = prompt("Commessa:", ore.commessa);
            if (!nuovaCommessa) return;
            
            const nuovaData = prompt("Data (YYYY-MM-DD):", ore.data);
            if (!nuovaData) return;
            
            const nuovaOraInizio = prompt("Ora inizio (HH:MM):", ore.oraInizio);
            if (!nuovaOraInizio) return;
            
            const nuovaOraFine = prompt("Ora fine (HH:MM):", ore.oraFine);
            if (!nuovaOraFine) return;
            
            const nuovaDescrizione = prompt("Descrizione:", ore.descrizione);
            if (!nuovaDescrizione) return;
            
            const nuovaNonConformita = confirm("Non conformità? (OK=Sì, Annulla=No)");

            const controllo = await this.controllaOrariGiornata(nuovaData, nuovaOraInizio, nuovaOraFine, id);
            if (!controllo.valido) {
                NotificationService.error(controllo.errore);
                return;
            }

            await this.pbService.updateDocument("oreLavorate", id, {
                commessa: nuovaCommessa,
                data: nuovaData,
                oraInizio: nuovaOraInizio,
                oraFine: nuovaOraFine,
                descrizione: nuovaDescrizione,
                nonConformita: nuovaNonConformita
            });

            NotificationService.success('Ore modificate con successo!');
            await this.ricaricaDatiOreConFiltri();

        } catch (error) {
            console.error('Errore modifica:', error);
            NotificationService.error('Errore durante la modifica');
        }
    }

    async eliminaOreLavorate(id) {
        if (!confirm('Sei sicuro di voler eliminare queste ore lavorate?')) return;
        
        try {
            await this.pbService.deleteDocument("oreLavorate", id);
            NotificationService.success('Ore eliminate con successo!');
            await this.ricaricaDatiOreConFiltri();
        } catch (error) {
            console.error('Errore eliminazione:', error);
            NotificationService.error('Errore durante l\'eliminazione');
        }
    }

    calcolaTotaleGenerale(oreFiltrate) {
        if (!Array.isArray(oreFiltrate)) return 0;
        return oreFiltrate.reduce((tot, ore) => {
            return tot + Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
        }, 0);
    }

    // ============================================================
    // 7.10 RICARICA DATI ORE CON FILTRI
    // ============================================================

    async ricaricaDatiOreConFiltri() {
        console.log('🔄 Ricarica dati ore mantenendo filtri e ordinamento...');
        
        try {
            const filtri = this.getFiltriOreAttivi();
            
            const hasFiltri = filtri.commessa || filtri.dipendente || 
                             filtri.anno || filtri.mese || filtri.giorno || 
                             filtri.nonConformita;
            
            let dati;
            
            if (hasFiltri) {
                dati = await this.pbService.getOreLavorateFiltrate(filtri);
                console.log(`📦 Ricaricati ${dati.length} record con filtri`);
            } else {
                dati = await this.pbService.getCollection("oreLavorate");
                console.log(`📦 Ricaricati ${dati.length} record (tutti)`);
            }
            
            if (stateManager.datiFiltrati && stateManager.datiFiltrati.length > 0) {
                const ordinamentoPrecedente = this.getOrdinamentoCorrente();
                if (ordinamentoPrecedente) {
                    dati = this.applicaOrdinamento(dati, ordinamentoPrecedente);
                    console.log(`📊 Ordinamento "${ordinamentoPrecedente}" riapplicato`);
                }
            } else {
                dati.sort((a, b) => {
                    if (a.data !== b.data) return b.data.localeCompare(a.data);
                    if (a.commessa !== b.commessa) return a.commessa.localeCompare(b.commessa, 'it');
                    if (a.oraInizio !== b.oraInizio) return a.oraInizio.localeCompare(b.oraInizio);
                    const nomeA = `${a.nomeDipendente} ${a.cognomeDipendente}`;
                    const nomeB = `${b.nomeDipendente} ${b.cognomeDipendente}`;
                    return nomeA.localeCompare(nomeB, 'it');
                });
            }
            
            stateManager.datiFiltrati = dati;
            stateManager.datiTotali.oreLavorate = dati;
            
            this.paginazione.ore.datiTotali = dati;
            this.paginazione.ore.paginaCorrente = 1;
            
            this.renderizzaTabellaOre(dati);
            
            this.paginazione.ore.render(dati, () => {
                console.log('🔄 Callback paginazione - ricarico');
                this.renderizzaTabellaOre(dati);
            });
            
            console.log('✅ Ricarica completata con successo');
            
        } catch (error) {
            console.error('❌ Errore ricarica:', error);
            NotificationService.error('Errore durante il ricaricamento dei dati');
        }
    }

    // ============================================================
    // 7.11 ORDINAMENTO E RENDERIZZAZIONE TABELLA ORE
    // ============================================================

    getOrdinamentoCorrente() {
        if (!stateManager.datiFiltrati || stateManager.datiFiltrati.length === 0) {
            return null;
        }
        return 'data_desc';
    }

    applicaOrdinamento(dati, criterio) {
        const copia = [...dati];
        switch(criterio) {
            case 'data_asc':
                copia.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
                break;
            case 'data_desc':
                copia.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
                break;
            default:
                copia.sort((a, b) => {
                    if (a.data !== b.data) return b.data.localeCompare(a.data);
                    if (a.commessa !== b.commessa) return a.commessa.localeCompare(b.commessa, 'it');
                    return a.oraInizio.localeCompare(b.oraInizio);
                });
        }
        return copia;
    }

    cambiaOrdineOre(criterio) {
        console.log(`🔄 Cambio ordinamento: ${criterio}`);
        
        try {
            let dati = [];
            
            if (stateManager.datiFiltrati && stateManager.datiFiltrati.length > 0) {
                dati = stateManager.datiFiltrati.slice();
            } else if (stateManager.datiTotali.oreLavorate && stateManager.datiTotali.oreLavorate.length > 0) {
                dati = stateManager.datiTotali.oreLavorate.slice();
            } else {
                this.pbService.getCollection("oreLavorate").then(ore => {
                    stateManager.datiTotali.oreLavorate = ore;
                    stateManager.datiFiltrati = ore.slice();
                    this.cambiaOrdineOre(criterio);
                }).catch(err => {
                    console.error('❌ Errore caricamento:', err);
                    NotificationService.error('Errore nel caricamento dei dati');
                });
                return;
            }
            
            if (dati.length === 0) {
                NotificationService.warning('Nessun dato da ordinare');
                return;
            }
            
            switch(criterio) {
                case 'data_asc':
                    dati.sort((a, b) => (a.data || '').localeCompare(b.data || ''));
                    NotificationService.info('📅 Ordinati per data (più vecchi prima)');
                    break;
                case 'data_desc':
                    dati.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
                    NotificationService.info('📅 Ordinati per data (più recenti prima)');
                    break;
                case 'commessa':
                    dati.sort((a, b) => (a.commessa || '').localeCompare(b.commessa || '', 'it'));
                    NotificationService.info('📋 Ordinati per commessa');
                    break;
                case 'dipendente':
                    dati.sort((a, b) => {
                        const nomeA = `${a.nomeDipendente || ''} ${a.cognomeDipendente || ''}`.trim();
                        const nomeB = `${b.nomeDipendente || ''} ${b.cognomeDipendente || ''}`.trim();
                        return nomeA.localeCompare(nomeB, 'it');
                    });
                    NotificationService.info('👤 Ordinati per dipendente');
                    break;
                case 'ore':
                    dati.sort((a, b) => {
                        const oreA = Utils.calcolaOreLavorate(a.oraInizio, a.oraFine);
                        const oreB = Utils.calcolaOreLavorate(b.oraInizio, b.oraFine);
                        return oreB - oreA;
                    });
                    NotificationService.info('⏱️ Ordinati per ore (maggiori prima)');
                    break;
                case 'ore_asc':
                    dati.sort((a, b) => {
                        const oreA = Utils.calcolaOreLavorate(a.oraInizio, a.oraFine);
                        const oreB = Utils.calcolaOreLavorate(b.oraInizio, b.oraFine);
                        return oreA - oreB;
                    });
                    NotificationService.info('⏱️ Ordinati per ore (minori prima)');
                    break;
                default:
                    dati.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
                    NotificationService.info('📅 Ordinamento predefinito');
            }
            
            stateManager.datiFiltrati = dati;
            stateManager.datiTotali.oreLavorate = dati;
            
            this.paginazione.ore.datiTotali = dati;
            this.paginazione.ore.paginaCorrente = 1;
            
            this.renderizzaTabellaOre(dati);
            
            this.paginazione.ore.render(dati, () => {
                console.log('🔄 Callback paginazione');
                this.renderizzaTabellaOre(dati);
            });
            
        } catch (error) {
            console.error('❌ Errore durante l\'ordinamento:', error);
            NotificationService.error('Errore durante l\'ordinamento: ' + error.message);
        }
    }

    renderizzaTabellaOre(dati) {
        console.log(`🔄 Renderizzazione tabella con ${dati ? dati.length : 0} record`);
        
        const tbody = document.querySelector('#orelavorateTable tbody');
        if (!tbody) {
            console.error('❌ Tbody ore lavorate non trovato');
            return;
        }

        if (!dati || dati.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center py-4 text-muted">
                        <i class="fas fa-clock fa-3x mb-3 d-block"></i>
                        <h5>Nessuna ore lavorata trovata</h5>
                        <p class="small">Registra le tue ore usando il form sopra</p>
                    </td>
                </tr>
            `;
            return;
        }

        const datiPagina = this.paginazione.ore.getDatiPagina();
        tbody.innerHTML = '';

        const headerRow = document.createElement('tr');
        headerRow.style.background = 'linear-gradient(135deg, #0f172a, #1e293b)';
        headerRow.innerHTML = `
            <td colspan="9" class="text-white text-center py-1" style="font-size: 0.8rem;">
                <i class="fas fa-list"></i> 
                <strong>${dati.length}</strong> record trovati 
                <span class="mx-2">•</span> 
                <i class="fas fa-calendar"></i> Mostrati <strong>${datiPagina.length}</strong> per pagina
                <span class="mx-2">•</span>
                <i class="fas fa-sort"></i> Ordinamento applicato
            </td>
        `;
        tbody.appendChild(headerRow);

        datiPagina.forEach((ore, index) => {
            const oreLavorate = Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
            const row = document.createElement('tr');
            
            row.style.background = index % 2 === 0 ? '#ffffff' : '#f8fafc';
            
            if (ore.nonConformita) {
                row.style.borderLeft = '4px solid #eab308';
            }
            
            const dataFormattata = Utils.formattaDataItaliana(ore.data);
            
            row.innerHTML = `
                <td>
                    <div class="d-flex align-items-center gap-1">
                        <span class="badge ${ore.nonConformita ? 'bg-warning text-dark' : 'bg-secondary'}">
                            ${ore.nonConformita ? '⚠️' : '✓'}
                        </span>
                        <strong>${Utils.escapeHtml(ore.commessa)}</strong>
                    </div>
                </td>
                <td>
                    <div class="d-flex flex-column">
                        <span class="fw-semibold">${Utils.escapeHtml(ore.nomeDipendente)} ${Utils.escapeHtml(ore.cognomeDipendente)}</span>
                        <small class="text-muted" style="font-size: 0.7rem;">${ore.emailDipendente || ''}</small>
                    </div>
                </td>
                <td class="text-center">
                    <span class="badge bg-light text-dark border" style="font-size: 0.8rem;">
                        <i class="fas fa-calendar-day"></i> ${dataFormattata}
                    </span>
                </td>
                <td class="text-center">
                    <span class="badge bg-primary bg-opacity-10 text-primary" style="font-size: 0.8rem;">
                        <i class="fas fa-play"></i> ${ore.oraInizio || '-'}
                    </span>
                </td>
                <td class="text-center">
                    <span class="badge bg-danger bg-opacity-10 text-danger" style="font-size: 0.8rem;">
                        <i class="fas fa-stop"></i> ${ore.oraFine || '-'}
                    </span>
                </td>
                <td>
                    <div style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" 
                         title="${Utils.escapeHtml(ore.descrizione || '')}">
                        ${Utils.escapeHtml(ore.descrizione || '-')}
                    </div>
                </td>
                <td class="text-center">
                    ${ore.nonConformita ? 
                        '<span class="badge bg-warning text-dark"><i class="fas fa-exclamation-triangle"></i> Sì</span>' : 
                        '<span class="badge bg-secondary text-white"><i class="fas fa-check"></i> No</span>'}
                </td>
                <td class="text-center">
                    <span class="badge bg-success" style="font-size: 0.9rem; padding: 4px 12px;">
                        <i class="fas fa-clock"></i> ${Utils.formattaOreDecimali(oreLavorate)}
                    </span>
                </td>
                <td class="text-center">
                    <div class="btn-group btn-group-sm" role="group">
                        <button class="btn btn-outline-warning btn-modifica-ore" 
                                data-id="${ore.id}" 
                                title="Modifica ore">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn btn-outline-danger btn-elimina-ore" 
                                data-id="${ore.id}" 
                                title="Elimina ore">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);

            row.querySelector('.btn-modifica-ore')?.addEventListener('click', (e) => {
                e.preventDefault();
                this.modificaOreLavorate(ore.id);
            });
            
            row.querySelector('.btn-elimina-ore')?.addEventListener('click', (e) => {
                e.preventDefault();
                this.eliminaOreLavorate(ore.id);
            });
        });

        const totale = this.calcolaTotaleGenerale(dati);
        const giorniLavorati = new Set(dati.map(o => o.data)).size;
        const dipendentiUnici = new Set(dati.map(o => `${o.nomeDipendente} ${o.cognomeDipendente}`)).size;
        
        const tr = document.createElement('tr');
        tr.style.background = 'linear-gradient(135deg, #0f172a, #1e293b)';
        tr.style.color = 'white';
        tr.style.fontWeight = 'bold';
        tr.innerHTML = `
            <td colspan="2" class="text-end">
                <i class="fas fa-calculator"></i> <strong>TOTALI</strong>
            </td>
            <td class="text-center">
                <span class="badge bg-light text-dark">
                    <i class="fas fa-calendar"></i> ${giorniLavorati} gg
                </span>
            </td>
            <td colspan="2" class="text-center">
                <span class="badge bg-light text-dark">
                    <i class="fas fa-users"></i> ${dipendentiUnici} dip.
                </span>
            </td>
            <td colspan="2" class="text-center">
                <span class="badge bg-light text-dark">
                    <i class="fas fa-file-alt"></i> ${dati.length} record
                </span>
            </td>
            <td class="text-center">
                <span class="badge bg-warning text-dark" style="font-size: 1rem; padding: 6px 16px;">
                    <i class="fas fa-clock"></i> ${Utils.formattaOreDecimali(totale)}
                </span>
            </td>
            <td></td>
        `;
        tbody.appendChild(tr);
    }

    // ============================================================
    // 7.12 GESTIONE DIPENDENTI (CORRETTA PER POCKETBASE)
    // ============================================================

async handleDipendentiForm(e) {
    e.preventDefault();
    try {
        const nome = document.getElementById('dipendenteNome').value.trim();
        const cognome = document.getElementById('dipendenteCognome').value.trim();
        const email = document.getElementById('dipendenteEmail').value.trim();
        const password = document.getElementById('dipendentePassword').value.trim();
        const ruolo = document.getElementById('dipendenteRuolo').value;

        if (!nome || !cognome || !email || !password) {
            NotificationService.error('Compila tutti i campi');
            return;
        }

        // 🔥 1. CREA L'UTENTE NELLA COLLECTION 'users'
        const userData = {
            email: email,
            password: password,
            passwordConfirm: password,
            name: nome + ' ' + cognome
        };

        console.log('📝 Creazione utente in PocketBase:', userData);

        const newUser = await this.pbService.pb.collection('users').create(userData);
        console.log('✅ Utente creato in PocketBase, ID:', newUser.id);

        // 🔥 2. SALVA I DETTAGLI NELLA COLLECTION 'dipendenti'
        const dipData = {
            userId: newUser.id,
            nome: nome,
            cognome: cognome,
            email: email,
            ruolo: ruolo
        };

        console.log('📝 Dati dipendente da salvare:', dipData);

        // 🔥 USA pb DIRETTAMENTE
        const dipRecord = await this.pbService.pb.collection('dipendenti').create(dipData);
        console.log('✅ Dipendente creato in dipendenti:', dipRecord.id);

        NotificationService.success(`Dipendente aggiunto con successo! (Ruolo: ${ruolo})`);
        await this.aggiornaTabellaDipendenti();
        e.target.reset();

    } catch (error) {
        console.error('❌ Errore aggiunta dipendente:', error);
        if (error.message && error.message.includes('email')) {
            NotificationService.error('Email già utilizzata da un altro utente');
        } else {
            NotificationService.error('Errore durante l\'aggiunta: ' + (error.message || 'Errore sconosciuto'));
        }
    }
}

    async aggiornaTabellaDipendenti() {
        const tbody = document.querySelector('#dipendentiTable tbody');
        if (!tbody) {
            console.error('❌ Tbody dipendenti non trovato');
            return;
        }

        try {
            let dipendenti = await this.pbService.getCollection("dipendenti");
            
            dipendenti.sort((a, b) => {
                const ruoloA = a.ruolo === 'admin' ? 0 : 1;
                const ruoloB = b.ruolo === 'admin' ? 0 : 1;
                if (ruoloA !== ruoloB) return ruoloA - ruoloB;
                return (a.cognome || '').localeCompare(b.cognome || '', 'it');
            });

            stateManager.datiTotali.dipendenti = dipendenti;
            this.paginazione.dipendenti.datiTotali = dipendenti;

            const datiPagina = this.paginazione.dipendenti.getDatiPagina();
            
            tbody.innerHTML = '';

            if (datiPagina.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-4 text-muted">
                            <i class="fas fa-users fa-3x mb-3 d-block"></i>
                            <h5>Nessun dipendente trovato</h5>
                            <p class="small">Aggiungi un nuovo dipendente usando il form sopra</p>
                        </td>
                    </tr>
                `;
            } else {
                datiPagina.forEach(d => {
                    const row = document.createElement('tr');
                    const mostraPassword = '••••••••';
                    
                    row.innerHTML = `
                        <td><strong>${Utils.escapeHtml(d.nome)}</strong></td>
                        <td>${Utils.escapeHtml(d.cognome)}</td>
                        <td>${Utils.escapeHtml(d.email)}</td>
                        <td><span class="font-monospace">${mostraPassword}</span></td>
                        <td>
                            <span class="badge ${d.ruolo === 'admin' ? 'bg-danger' : 'bg-info'}">
                                ${d.ruolo || 'dipendente'}
                            </span>
                        </td>
                        <td>
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-warning btn-modifica-dipendente" 
                                        data-id="${d.id}" 
                                        title="Modifica dipendente">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-danger btn-elimina-dipendente" 
                                        data-id="${d.id}" 
                                        title="Elimina dipendente">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(row);

                    row.querySelector('.btn-modifica-dipendente')?.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.modificaDipendente(d.id);
                    });
                    
                    row.querySelector('.btn-elimina-dipendente')?.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.eliminaDipendente(d.id);
                    });
                });
            }

            this.paginazione.dipendenti.render(dipendenti, () => {
                console.log(`🔄 Callback paginazione dipendenti - ricarico`);
                this.aggiornaTabellaDipendenti();
            });

        } catch (error) {
            console.error('❌ Errore tabella dipendenti:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-danger py-4">
                        <i class="fas fa-exclamation-triangle fa-2x mb-2 d-block"></i>
                        Errore nel caricamento: ${error.message}
                        <br>
                        <button class="btn btn-sm btn-primary mt-2" onclick="app.aggiornaTabellaDipendenti()">
                            <i class="fas fa-sync-alt"></i> Riprova
                        </button>
                    </td>
                </tr>
            `;
        }
    }

    async modificaDipendente(id) {
        try {
            const doc = await this.pbService.getRecord("dipendenti", id);
            if (!doc) {
                NotificationService.error('Dipendente non trovato');
                return;
            }
            
            const nome = prompt("Nome:", doc.nome);
            if (!nome) return;
            
            const cognome = prompt("Cognome:", doc.cognome);
            if (!cognome) return;
            
            const email = prompt("Email:", doc.email);
            if (!email) return;
            
            const ruolo = prompt("Ruolo (admin/dipendente):", doc.ruolo || 'dipendente');
            if (!ruolo) return;
            
            await this.pbService.updateDocument("dipendenti", id, {
                nome, cognome, email, ruolo
            });
            
            NotificationService.success('Dipendente modificato!');
            await this.aggiornaTabellaDipendenti();

        } catch (error) {
            console.error('Errore modifica:', error);
            NotificationService.error('Errore durante la modifica');
        }
    }

    async eliminaDipendente(id) {
        if (!confirm('Sei sicuro di voler eliminare questo dipendente?')) return;
        
        try {
            await this.pbService.deleteDocument("dipendenti", id);
            NotificationService.success('Dipendente eliminato!');
            await this.aggiornaTabellaDipendenti();
        } catch (error) {
            console.error('Errore eliminazione:', error);
            NotificationService.error('Errore durante l\'eliminazione');
        }
    }

    // ============================================================
    // 7.13 GESTIONE COMMESSE
    // ============================================================

    async aggiornaTabellaCommesse() {
        const tbody = document.querySelector('#commesseTable tbody');
    if (!tbody) {
        console.error('❌ Tbody commesse non trovato');
        return;
    }

    try {
        // 🔥 CARICA I DATI DA POCKETBASE (SENZA CACHE)
        let commesse = await this.pbService.getCollection("commesse");
        console.log('📋 Commesse caricate:', commesse.length);

        // 🔥 ORDINA PER DATA (più recenti prima)
        commesse.sort((a, b) => {
            const dataA = a.dataInizio || a.created || '';
            const dataB = b.dataInizio || b.created || '';
            return dataB.localeCompare(dataA);
        });

            stateManager.datiTotali.commesse = commesse;
            this.paginazione.commesse.datiTotali = commesse;

            const datiPagina = this.paginazione.commesse.getDatiPagina();
            
            tbody.innerHTML = '';

            if (datiPagina.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="text-center py-4 text-muted">
                            <i class="fas fa-inbox fa-3x mb-3 d-block"></i>
                            <h5>Nessuna commessa trovata</h5>
                            <p class="small">Aggiungi una nuova commessa usando il form sopra</p>
                        </td>
                    </tr>
                `;
            } else {
                datiPagina.forEach(commessa => {
                    const stato = commessa.stato || 'attiva';
                    const row = document.createElement('tr');
                    
                    if (stato === 'conclusa') {
                        row.classList.add('commessa-conclusa');
                    }

                    const dataInizio = commessa.dataInizio || commessa.dataCreazione?.split('T')[0] || '';
                    const dataFormattata = dataInizio ? Utils.formattaDataItaliana(dataInizio) : '-';
                    const oreTotali = commessa.oreTotaliPreviste || 0;
                    const oreIntegrazione = commessa.oreIntegrazione || 0;
                    
                    const fatturato = commessa.fatturato || 'da_fatturare';
                    const fatturatoBadge = fatturato === 'fatturato' ? 
                        '<span class="badge bg-success"><i class="fas fa-check-circle"></i> Fatturato</span>' :
                        '<span class="badge bg-warning text-dark"><i class="fas fa-clock"></i> Da fatturare</span>';
                    
                    row.innerHTML = `
                        <td>
                            <strong>${Utils.escapeHtml(commessa.nomeCommessa)}</strong>
                            ${oreIntegrazione > 0 ? `<br><small class="text-warning">➕ +${Utils.formattaOreDecimali(oreIntegrazione)} integrazione</small>` : ''}
                        </td>
                        <td>${Utils.escapeHtml(commessa.cliente || 'N/D')}</td>
                        <td class="text-end">€ ${(commessa.valorePreventivo || 0).toFixed(2)}</td>
                        <td class="text-center">${Utils.formattaOreDecimali(oreTotali)} ore</td>
                        <td class="text-center">${dataFormattata}</td>
                        <td class="text-center">
                            <span class="badge ${stato === 'attiva' ? 'badge-attiva' : 'badge-conclusa'}">
                                ${stato === 'attiva' ? '🟢 ATTIVA' : '🔴 CONCLUSA'}
                            </span>
                        </td>
                        <td class="text-center">${fatturatoBadge}</td>
                        <td class="text-center">
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-warning btn-modifica-commessa" data-id="${commessa.id}" title="Modifica">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-secondary btn-cambia-stato-commessa" 
                                        data-id="${commessa.id}" data-stato="${stato}" 
                                        title="${stato === 'attiva' ? 'Concludi' : 'Riattiva'}">
                                    ${stato === 'attiva' ? '🔒' : '↩️'}
                                </button>
                                <button class="btn btn-danger btn-elimina-commessa" data-id="${commessa.id}" title="Elimina">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(row);

                    row.querySelector('.btn-modifica-commessa')?.addEventListener('click', () => this.modificaCommessa(commessa.id));
                    row.querySelector('.btn-cambia-stato-commessa')?.addEventListener('click', () => this.cambiaStatoCommessa(commessa.id, stato));
                    row.querySelector('.btn-elimina-commessa')?.addEventListener('click', () => this.eliminaCommessa(commessa.id));
                });
            }

            this.paginazione.commesse.render(commesse, () => {
                console.log(`🔄 Callback paginazione commesse - ricarico`);
                this.aggiornaTabellaCommesse();
            });

        } catch (error) {
            console.error('❌ Errore tabella commesse:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center text-danger py-4">
                        <i class="fas fa-exclamation-triangle fa-2x mb-2 d-block"></i>
                        Errore: ${error.message}
                        <br>
                        <button class="btn btn-sm btn-primary mt-2" onclick="app.aggiornaTabellaCommesse()">
                            <i class="fas fa-sync-alt"></i> Riprova
                        </button>
                    </td>
                </tr>
            `;
        }
    }

async handleCommessaForm(e) {
    // 🔥 PREVIENE DOPPIO SALVATAGGIO
    if (this.salvataggioInCorso) {
        console.log('⚠️ Salvataggio già in corso, salto...');
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    this.salvataggioInCorso = true;
    
    // Disabilita il pulsante submit
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';
    }

    try {
        const nomeCommessa = document.getElementById('nomeCommessa').value.trim();
        const cliente = document.getElementById('cliente').value.trim();
        const valorePreventivo = parseFloat(document.getElementById('valorePreventivo').value);
        const statoCommessa = document.getElementById('statoCommessa').value;
        const dataInizio = document.getElementById('dataCommessa').value; // 🔥 PRENDE LA DATA

        console.log('📝 Dati commessa:', { nomeCommessa, cliente, valorePreventivo, statoCommessa, dataInizio });

        if (!nomeCommessa || !cliente || !valorePreventivo || !dataInizio) {
            NotificationService.error('Compila tutti i campi');
            return;
        }

        // 🔥 CHIEDI SE LA COMMESSA È FATTURATA
        const fatturato = confirm("La commessa è già stata fatturata? (OK=Sì, Annulla=No)") ? 'fatturato' : 'da_fatturare';

        const oreTotaliPreviste = valorePreventivo / CONFIG.TARIFFA_ORARIA;

        // 🔥 PREPARA I DATI CON LA DATA NEL FORMATO CORRETTO
        const dataCommessa = {
            nomeCommessa: nomeCommessa,
            cliente: cliente,
            valorePreventivo: valorePreventivo,
            oreTotaliPreviste: parseFloat(oreTotaliPreviste.toFixed(2)),
            oreIntegrazione: 0,
            dataInizio: dataInizio, // 🔥 SALVA LA DATA COSÌ COM'È (YYYY-MM-DD)
            stato: statoCommessa,
            fatturato: fatturato,
            dataCreazione: new Date().toISOString(),
            dataUltimaModifica: new Date().toISOString()
        };

        // Se fatturato, aggiungi data fatturazione
        if (fatturato === 'fatturato') {
            dataCommessa.dataFatturazione = new Date().toISOString();
        }

        console.log('📤 Invio dati a PocketBase:', dataCommessa);

        await this.pbService.addDocument("commesse", dataCommessa);

        NotificationService.success(`Commessa aggiunta con successo! (${fatturato === 'fatturato' ? '✅ Fatturata' : '⏳ Da fatturare'})`);
        
        // 🔥 AGGIORNA TUTTE LE TABELLE
        await Promise.all([
            this.aggiornaTabellaCommesse(),
            this.aggiornaMenuCommesse(),
            this.aggiornaMonitorCommesse()
        ]);
        
        e.target.reset();

    } catch (error) {
        console.error('❌ Errore aggiunta commessa:', error);
        NotificationService.error('Errore durante l\'aggiunta: ' + error.message);
    } finally {
        this.salvataggioInCorso = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Aggiungi Commessa';
        }
    }
}

    async modificaCommessa(id) {
        try {
            const c = await this.pbService.getRecord("commesse", id);
            if (!c) {
                NotificationService.error('Commessa non trovata');
                return;
            }
            
            const nome = prompt("Nome commessa:", c.nomeCommessa);
            if (!nome) return;
            
            const cliente = prompt("Cliente:", c.cliente);
            if (!cliente) return;
            
            const preventivo = parseFloat(prompt("Valore preventivo (€):", c.valorePreventivo));
            if (isNaN(preventivo) || preventivo <= 0) {
                NotificationService.error('Valore non valido');
                return;
            }
            
            const data = prompt("Data inizio (YYYY-MM-DD):", c.dataInizio || '');
            if (!data) return;
            
            const stato = confirm("Commessa attiva? (OK=Attiva, Annulla=Conclusa)") ? 'attiva' : 'conclusa';
            const fatturato = confirm("Commessa fatturata? (OK=Sì, Annulla=No)") ? 'fatturato' : 'da_fatturare';

            const oreTotali = preventivo / CONFIG.TARIFFA_ORARIA;

            const updateData = {
                nomeCommessa: nome,
                cliente: cliente,
                valorePreventivo: preventivo,
                oreTotaliPreviste: parseFloat(oreTotali.toFixed(2)),
                oreIntegrazione: c.oreIntegrazione || 0,
                dataInizio: data,
                stato: stato,
                fatturato: fatturato,
                dataUltimaModifica: new Date().toISOString()
            };

            if (fatturato === 'fatturato') {
                updateData.dataFatturazione = new Date().toISOString();
            }

            await this.pbService.updateDocument("commesse", id, updateData);

            NotificationService.success('Commessa modificata!');
            await Promise.all([
                this.aggiornaTabellaCommesse(),
                this.aggiornaMenuCommesse(),
                this.aggiornaMonitorCommesse()
            ]);

        } catch (error) {
            console.error('Errore modifica:', error);
            NotificationService.error('Errore durante la modifica');
        }
    }

    async eliminaCommessa(id) {
        if (!confirm('Sei sicuro di voler eliminare questa commessa?\nQuesta azione è irreversibile!')) return;
        
        try {
            await this.pbService.deleteDocument("commesse", id);
            NotificationService.success('Commessa eliminata!');
            await Promise.all([
                this.aggiornaTabellaCommesse(),
                this.aggiornaMenuCommesse(),
                this.aggiornaMonitorCommesse()
            ]);
        } catch (error) {
            console.error('Errore eliminazione:', error);
            NotificationService.error('Errore durante l\'eliminazione');
        }
    }

    async cambiaStatoCommessa(id, statoAttuale) {
        try {
            const nuovoStato = statoAttuale === 'attiva' ? 'conclusa' : 'attiva';
            const azione = nuovoStato === 'conclusa' ? 'concludere' : 'riattivare';
            
            if (!confirm(`Sei sicuro di voler ${azione} questa commessa?`)) return;

            await this.pbService.updateDocument("commesse", id, {
                stato: nuovoStato,
                dataUltimaModifica: new Date().toISOString()
            });

            NotificationService.success(`Commessa ${nuovoStato === 'conclusa' ? 'conclusa' : 'riattivata'}!`);
            await Promise.all([
                this.aggiornaTabellaCommesse(),
                this.aggiornaMenuCommesse(),
                this.aggiornaMonitorCommesse()
            ]);

        } catch (error) {
            console.error('Errore cambio stato:', error);
            NotificationService.error('Errore durante il cambio stato');
        }
    }

    // ============================================================
    // 7.14 GESTIONE FORNITORI
    // ============================================================

    async caricaFornitori() {
        try {
            const fornitori = await this.pbService.getCollection("fornitoriLavorazioni");
            stateManager.datiTotali.fornitori = fornitori;
            this.paginazione.fornitori.aggiornaDati(fornitori);
            await this.aggiornaTabellaFornitori();
            await this.popolaSelectCommessePerFornitore();
        } catch (error) {
            console.error('Errore caricamento fornitori:', error);
        }
    }

    async aggiornaTabellaFornitori() {
        const tbody = document.querySelector('#fornitoriTable tbody');
        if (!tbody) {
            console.error('❌ Tbody fornitori non trovato');
            return;
        }

        try {
            let fornitori = await this.pbService.getCollection("fornitoriLavorazioni");
            
            fornitori.sort((a, b) => {
                const dataA = a.data || a.dataCreazione || '';
                const dataB = b.data || b.dataCreazione || '';
                return dataB.localeCompare(dataA);
            });

            stateManager.datiTotali.fornitori = fornitori;
            this.paginazione.fornitori.datiTotali = fornitori;

            const datiPagina = this.paginazione.fornitori.getDatiPagina();
            
            tbody.innerHTML = '';

            if (datiPagina.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center py-4 text-muted">
                            <i class="fas fa-truck fa-3x mb-3 d-block"></i>
                            <h5>Nessuna lavorazione fornitore registrata</h5>
                            <p class="small">Aggiungi una lavorazione usando il form sopra</p>
                        </td>
                    </tr>
                `;
            } else {
                datiPagina.forEach(f => {
                    const row = document.createElement('tr');
                    const dataFormattata = f.data ? Utils.formattaDataItaliana(f.data) : '-';
                    
                    row.innerHTML = `
                        <td><strong>${Utils.escapeHtml(f.nomeFornitore)}</strong></td>
                        <td>${Utils.escapeHtml(f.commessa)}</td>
                        <td class="text-end"><strong>€ ${(f.costo || 0).toFixed(2)}</strong></td>
                        <td>${Utils.escapeHtml(f.descrizione || '-')}</td>
                        <td>${dataFormattata}</td>
                        <td class="text-center">
                            <div class="btn-group btn-group-sm" role="group">
                                <button class="btn btn-warning btn-modifica-fornitore" 
                                        data-id="${f.id}" 
                                        title="Modifica lavorazione">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-danger btn-elimina-fornitore" 
                                        data-id="${f.id}" 
                                        title="Elimina lavorazione">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(row);

                    row.querySelector('.btn-modifica-fornitore')?.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.modificaLavorazioneFornitore(f.id);
                    });
                    
                    row.querySelector('.btn-elimina-fornitore')?.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.eliminaLavorazioneFornitore(f.id);
                    });
                });

                const totaleCosti = fornitori.reduce((sum, f) => sum + (parseFloat(f.costo) || 0), 0);
                const tr = document.createElement('tr');
                tr.className = 'table-info fw-bold';
                tr.innerHTML = `
                    <td colspan="2" class="text-end">TOTALE COSTI FORNITORI</td>
                    <td class="text-end"><strong>€ ${totaleCosti.toFixed(2)}</strong></td>
                    <td colspan="3"></td>
                `;
                tbody.appendChild(tr);
            }

            this.paginazione.fornitori.render(fornitori, () => {
                console.log(`🔄 Callback paginazione fornitori - ricarico`);
                this.aggiornaTabellaFornitori();
            });

        } catch (error) {
            console.error('❌ Errore tabella fornitori:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-danger py-4">
                        <i class="fas fa-exclamation-triangle fa-2x mb-2 d-block"></i>
                        Errore nel caricamento: ${error.message}
                        <br>
                        <button class="btn btn-sm btn-primary mt-2" onclick="app.aggiornaTabellaFornitori()">
                            <i class="fas fa-sync-alt"></i> Riprova
                        </button>
                    </td>
                </tr>
            `;
        }
    }

    async aggiungiLavorazioneFornitore(e) {
        e.preventDefault();
        if (this.salvataggioInCorso) return;
        this.salvataggioInCorso = true;

        try {
            const nomeFornitore = document.getElementById('fornitoreNome').value.trim();
            const commessa = document.getElementById('fornitoreCommessa').value;
            const costo = parseFloat(document.getElementById('fornitoreCosto').value);
            const descrizione = document.getElementById('fornitoreDescrizione').value.trim();
            const data = document.getElementById('fornitoreData').value || new Date().toISOString().split('T')[0];

            if (!nomeFornitore || !commessa || isNaN(costo) || costo <= 0) {
                NotificationService.error('Compila tutti i campi obbligatori');
                return;
            }

            await this.pbService.addDocument("fornitoriLavorazioni", {
                nomeFornitore,
                commessa,
                costo,
                descrizione,
                data,
                dataCreazione: new Date().toISOString()
            });

            NotificationService.success('Lavorazione fornitore aggiunta!');
            document.getElementById('fornitoreForm').reset();
            await this.caricaFornitori();
            await this.aggiornaMonitorCommesse();
            await this.ricaricaDatiOreConFiltri();

        } catch (error) {
            console.error('Errore aggiunta fornitore:', error);
            NotificationService.error('Errore durante l\'aggiunta');
        } finally {
            this.salvataggioInCorso = false;
        }
    }

    async modificaLavorazioneFornitore(id) {
        try {
            const f = await this.pbService.getRecord("fornitoriLavorazioni", id);
            if (!f) {
                NotificationService.error('Lavorazione non trovata');
                return;
            }
            
            const nome = prompt("Nome fornitore:", f.nomeFornitore);
            if (!nome) return;
            
            const commessa = prompt("Commessa:", f.commessa);
            if (!commessa) return;
            
            const costo = parseFloat(prompt("Costo (€):", f.costo));
            if (isNaN(costo) || costo <= 0) {
                NotificationService.error('Costo non valido');
                return;
            }
            
            const descrizione = prompt("Descrizione:", f.descrizione || '');
            const data = prompt("Data (YYYY-MM-DD):", f.data || '');

            await this.pbService.updateDocument("fornitoriLavorazioni", id, {
                nomeFornitore: nome,
                commessa,
                costo,
                descrizione: descrizione || '',
                data: data || '',
                dataModifica: new Date().toISOString()
            });

            NotificationService.success('Lavorazione modificata!');
            await Promise.all([
                this.caricaFornitori(),
                this.aggiornaMonitorCommesse()
            ]);

        } catch (error) {
            console.error('Errore modifica:', error);
            NotificationService.error('Errore durante la modifica');
        }
    }

    async eliminaLavorazioneFornitore(id) {
        if (!confirm('Sei sicuro di voler eliminare questa lavorazione fornitore?')) return;
        
        try {
            await this.pbService.deleteDocument("fornitoriLavorazioni", id);
            NotificationService.success('Lavorazione eliminata!');
            await Promise.all([
                this.caricaFornitori(),
                this.aggiornaMonitorCommesse()
            ]);
        } catch (error) {
            console.error('Errore eliminazione:', error);
            NotificationService.error('Errore durante l\'eliminazione');
        }
    }

    async popolaSelectCommessePerFornitore() {
        const select = document.getElementById('fornitoreCommessa');
        if (!select) return;
        
        select.innerHTML = '<option value="">Seleziona una commessa</option>';

        try {
            const commesse = await this.pbService.getCollection("commesse");
            const disponibili = commesse
                .filter(c => c && c.nomeCommessa)
                .sort((a, b) => (a.nomeCommessa || '').localeCompare(b.nomeCommessa || '', 'it'));

            disponibili.forEach(c => {
                const option = document.createElement('option');
                option.value = c.nomeCommessa;
                const stato = c.stato === 'attiva' ? '🟢' : '🔴';
                option.textContent = `${stato} ${c.nomeCommessa} - ${c.cliente || 'N/D'}`;
                select.appendChild(option);
            });
        } catch (error) {
            console.error('Errore caricamento commesse:', error);
        }
    }

    // ============================================================
    // 7.15 MONITORAGGIO COMMESSE
    // ============================================================

    async aggiornaMonitorCommesse() {
        try {
            const [commesse, tutteLeOre] = await Promise.all([
    this.pbService.getCollection("commesse"),
    this.pbService.getCollection("oreLavorate")
]);

            const filtroNome = document.getElementById('filtroNomeCommessa')?.value.trim() || '';
            const filtroStato = document.getElementById('filtroCommessaMonitor')?.value || '';
            const filtroAnno = document.getElementById('filtroAnnoMonitor')?.value || '';
            const filtroMese = document.getElementById('filtroMeseMonitor')?.value || '';
            const filtroFatturato = document.getElementById('filtroFatturato')?.value || '';
            
            let commesseFiltrate = commesse.filter(c => c && c.nomeCommessa);

            if (filtroNome) {
                const f = filtroNome.toLowerCase();
                commesseFiltrate = commesseFiltrate.filter(c => 
                    c.nomeCommessa.toLowerCase().includes(f)
                );
            }

            if (filtroStato === 'attive') {
                commesseFiltrate = commesseFiltrate.filter(c => c.stato === 'attiva' || !c.stato);
            } else if (filtroStato === 'concluse') {
                commesseFiltrate = commesseFiltrate.filter(c => c.stato === 'conclusa');
            }

            if (filtroAnno) {
                commesseFiltrate = commesseFiltrate.filter(c => {
                    const data = c.dataInizio || c.dataCreazione;
                    return data && data.split('-')[0] === filtroAnno;
                });
            }

            if (filtroMese) {
                commesseFiltrate = commesseFiltrate.filter(c => {
                    const data = c.dataInizio || c.dataCreazione;
                    return data && data.split('-')[1] === filtroMese;
                });
            }
            
            if (filtroFatturato) {
                commesseFiltrate = commesseFiltrate.filter(c => 
                    (c.fatturato || 'da_fatturare') === filtroFatturato
                );
            }

            commesseFiltrate.sort((a, b) => {
                const statoA = a.stato === 'attiva' ? 0 : 1;
                const statoB = b.stato === 'attiva' ? 0 : 1;
                if (statoA !== statoB) return statoA - statoB;
                return (a.nomeCommessa || '').localeCompare(b.nomeCommessa || '', 'it');
            });

            const tbody = document.querySelector('#monitorCommesseTable tbody');
            if (!tbody) return;

            tbody.innerHTML = '';

            if (commesseFiltrate.length === 0) {
                tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4">Nessuna commessa trovata</td></tr>`;
                return;
            }

            const fornitori = stateManager.datiTotali.fornitori || [];

            for (const commessa of commesseFiltrate) {
                const stats = this.calcolaStatisticheCommessa(commessa, tutteLeOre, fornitori);
                const row = this.creaRigaMonitoraggio(commessa, stats);
                tbody.appendChild(row);
            }

        } catch (error) {
            console.error('Errore monitoraggio:', error);
            const tbody = document.querySelector('#monitorCommesseTable tbody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger">Errore nel caricamento</td></tr>`;
            }
        }
    }

    calcolaStatisticheCommessa(commessa, tutteLeOre, fornitori) {
        const valorePreventivo = parseFloat(commessa.valorePreventivo) || 0;
        const oreTotaliPreviste = parseFloat(commessa.oreTotaliPreviste) || 0;
        const oreIntegrazione = parseFloat(commessa.oreIntegrazione) || 0;

        const costiFornitori = fornitori
            .filter(f => f.commessa === commessa.nomeCommessa)
            .reduce((tot, f) => tot + (parseFloat(f.costo) || 0), 0);

        const oreCommessa = tutteLeOre.filter(ore => 
            ore.commessa?.toLowerCase().trim() === commessa.nomeCommessa?.toLowerCase().trim()
        );

        let oreLavorateTotali = 0;
        let oreNonConformita = 0;

        oreCommessa.forEach(ore => {
            const oreCalc = Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
            if (!isNaN(oreCalc) && oreCalc > 0) {
                oreLavorateTotali += oreCalc;
                if (ore.nonConformita === true) {
                    oreNonConformita += oreCalc;
                }
            }
        });

        const tariffa = CONFIG.TARIFFA_ORARIA;
        const oreConformi = oreLavorateTotali - oreNonConformita;
        const costoDipendenti = (oreConformi * tariffa) + (oreNonConformita * CONFIG.COSTO_ORARIO_NON_CONFORMITA);
        const costoTotale = costoDipendenti + costiFornitori;

        const valoreIntegrazione = oreIntegrazione * tariffa;
        const ricavoTotale = valorePreventivo + valoreIntegrazione;

        const margineEuro = ricavoTotale - costoTotale;
        const marginePercentuale = ricavoTotale > 0 ? (margineEuro / ricavoTotale) * 100 : 0;

        return {
            valorePreventivo,
            oreTotaliPreviste,
            oreIntegrazione,
            valoreIntegrazione,
            ricavoTotale,
            oreLavorateTotali: parseFloat(oreLavorateTotali.toFixed(2)),
            oreNonConformita: parseFloat(oreNonConformita.toFixed(2)),
            oreConformi: parseFloat(oreConformi.toFixed(2)),
            costoDipendenti: parseFloat(costoDipendenti.toFixed(2)),
            costiFornitori: parseFloat(costiFornitori.toFixed(2)),
            costoTotale: parseFloat(costoTotale.toFixed(2)),
            margineEuro: parseFloat(margineEuro.toFixed(2)),
            marginePercentuale: parseFloat(marginePercentuale.toFixed(1)),
            hasIntegrazione: oreIntegrazione > 0,
            hasFornitori: costiFornitori > 0,
            datiCompleti: valorePreventivo > 0
        };
    }

    creaRigaMonitoraggio(commessa, stats) {
        const row = document.createElement('tr');
        const stato = commessa.stato || 'attiva';
        const isAttiva = stato === 'attiva';

        if (!isAttiva) row.classList.add('commessa-conclusa');

        const statoMargine = this.getStatoMargine(stats);
        const oreLavForm = Utils.formattaOreDecimali(stats.oreLavorateTotali);
        const orePrevForm = Utils.formattaOreDecimali(stats.oreTotaliPreviste);
        const oreNCForm = Utils.formattaOreDecimali(stats.oreNonConformita);
        const oreIntegrForm = Utils.formattaOreDecimali(stats.oreIntegrazione);

        row.innerHTML = `
            <td>
                <strong>${Utils.escapeHtml(commessa.nomeCommessa)}</strong>
                <br><small class="text-muted">${Utils.escapeHtml(commessa.cliente || 'N/D')}</small>
                ${stats.hasIntegrazione ? '<br><span class="badge bg-warning text-dark">💰 Integr.</span>' : ''}
                ${stats.hasFornitori ? '<br><span class="badge bg-info">🏭 Forn.</span>' : ''}
            </td>
            <td class="text-end">
                <strong>€ ${stats.valorePreventivo.toFixed(2)}</strong>
                ${stats.hasIntegrazione ? `<br><small>+ € ${stats.valoreIntegrazione.toFixed(2)}</small>` : ''}
                ${stats.hasIntegrazione ? `<br><strong class="text-primary">€ ${stats.ricavoTotale.toFixed(2)}</strong>` : ''}
            </td>
            <td class="text-center">
                <strong class="${stats.oreLavorateTotali > stats.oreTotaliPreviste ? 'text-danger' : ''}">
                    ${oreLavForm}
                </strong>
                <br><small>/ ${orePrevForm}</small>
                ${stats.hasIntegrazione ? `<br><small class="text-warning">+${oreIntegrForm}</small>` : ''}
            </td>
            <td class="text-center ${stats.oreNonConformita > 0 ? 'text-warning fw-bold' : ''}">
                ${oreNCForm}
                ${stats.oreNonConformita > 0 ? '<br><small>⚠️ NC</small>' : ''}
            </td>
            <td class="text-center ${stats.hasIntegrazione ? 'bg-warning bg-opacity-25' : ''}">
                ${stats.hasIntegrazione ? `<strong class="text-success">+${oreIntegrForm}</strong>` : '-'}
            </td>
            <td class="text-end">
                <strong>€ ${stats.costoDipendenti.toFixed(2)}</strong>
                <br><small>${Utils.formattaOreDecimali(stats.oreConformi)}h conf.</small>
                ${stats.oreNonConformita > 0 ? `<br><small class="text-danger">${oreNCForm}h NC</small>` : ''}
            </td>
            <td class="text-end ${stats.hasFornitori ? 'bg-light' : ''}">
                ${stats.hasFornitori ? `<strong>€ ${stats.costiFornitori.toFixed(2)}</strong>` : '-'}
            </td>
            <td class="text-end fw-bold bg-light">
                <strong>€ ${stats.costoTotale.toFixed(2)}</strong>
            </td>
            <td class="text-end ${stats.margineEuro >= 0 ? 'text-success' : 'text-danger'} fw-bold">
                ${stats.margineEuro >= 0 ? '+' : ''}€ ${stats.margineEuro.toFixed(2)}
            </td>
            <td class="text-end ${stats.margineEuro >= 0 ? 'text-success' : 'text-danger'} fw-bold">
                ${stats.marginePercentuale >= 0 ? '+' : ''}${stats.marginePercentuale.toFixed(1)}%
                <div class="progress mt-1" style="height: 4px; width: 60px; margin: 0 auto;">
                    <div class="progress-bar ${stats.marginePercentuale >= 20 ? 'bg-success' : stats.marginePercentuale >= 10 ? 'bg-info' : stats.marginePercentuale >= 0 ? 'bg-warning' : 'bg-danger'}" 
                         style="width: ${Math.min(100, Math.max(0, 50 + stats.marginePercentuale))}%">
                    </div>
                </div>
            </td>
            <td class="text-center">
                <span class="badge ${isAttiva ? 'badge-attiva' : 'badge-conclusa'} d-block mb-1">
                    ${isAttiva ? 'ATTIVA' : 'CONCLUSA'}
                </span>
                <span class="badge ${statoMargine.classe} d-block">
                    ${statoMargine.testo}
                </span>
                <button class="btn btn-sm btn-outline-secondary mt-1 w-100 btn-cambia-stato-monitor" 
                        data-id="${commessa.id}" data-stato="${stato}">
                    ${isAttiva ? '🔒 Concludi' : '↩️ Riattiva'}
                </button>
                ${stats.hasIntegrazione ? `
                    <button class="btn btn-sm btn-outline-warning mt-1 w-100 btn-modifica-integrazione" 
                            data-id="${commessa.id}" data-ore="${stats.oreIntegrazione}">
                        ✏️ ${oreIntegrForm}
                    </button>
                ` : `
                    <button class="btn btn-sm btn-outline-success mt-1 w-100 btn-aggiungi-integrazione" 
                            data-id="${commessa.id}">
                        ➕ Integr.
                    </button>
                `}
            </td>
        `;

        row.querySelector('.btn-cambia-stato-monitor')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            this.cambiaStatoCommessa(btn.dataset.id, btn.dataset.stato);
        });

        row.querySelector('.btn-aggiungi-integrazione')?.addEventListener('click', (e) => {
            this.aggiungiIntegrazione(e.currentTarget.dataset.id);
        });

        row.querySelector('.btn-modifica-integrazione')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            this.modificaIntegrazione(btn.dataset.id, parseFloat(btn.dataset.ore));
        });

        return row;
    }

    getStatoMargine(stats) {
        const m = stats.marginePercentuale;
        if (m >= 30) return { testo: 'ECCELLENTE', classe: 'bg-success' };
        if (m >= 20) return { testo: 'BUONO', classe: 'bg-info' };
        if (m >= 10) return { testo: 'SUFFICIENTE', classe: 'bg-warning text-dark' };
        if (m >= 0) return { testo: 'LIMITE', classe: 'bg-danger' };
        return { testo: 'IN PERDITA', classe: 'bg-dark' };
    }

    // ============================================================
    // 7.16 INTEGRAZIONE ORE
    // ============================================================

    async aggiungiIntegrazione(commessaId) {
        const input = prompt("Inserisci le ore di integrazione (es: 10.5 per 10h 30min):", "0");
        if (input === null) return;
        
        let ore = parseFloat(input.replace(',', '.'));
        if (isNaN(ore) || ore < 0) {
            NotificationService.error('Inserisci un numero valido');
            return;
        }
        
        ore = Math.round(ore * 100) / 100;

        try {
            await this.pbService.updateDocument("commesse", commessaId, {
                oreIntegrazione: ore,
                dataUltimaModifica: new Date().toISOString()
            });
            
            NotificationService.success(ore > 0 ? `✅ +${ore} ore di integrazione` : '🗑️ Integrazione rimossa');
            await this.aggiornaMonitorCommesse();
        } catch (error) {
            console.error('Errore integrazione:', error);
            NotificationService.error('Errore durante l\'aggiunta');
        }
    }

    async modificaIntegrazione(commessaId, oreCorrenti) {
        const oreFormattate = Utils.formattaOreDecimali(oreCorrenti);
        const input = prompt(`Ore integrazione attuali: ${oreFormattate}\n\nNuovo valore (0 per rimuovere):`, 
                            oreCorrenti.toString().replace('.', ','));
        if (input === null) return;
        
        let ore = parseFloat(input.replace(',', '.'));
        if (isNaN(ore) || ore < 0) {
            NotificationService.error('Inserisci un numero valido');
            return;
        }
        
        ore = Math.round(ore * 100) / 100;

        try {
            await this.pbService.updateDocument("commesse", commessaId, {
                oreIntegrazione: ore,
                dataUltimaModifica: new Date().toISOString()
            });
            
            NotificationService.success(ore > 0 ? `✅ Integrazione aggiornata: +${ore} ore` : '🗑️ Integrazione rimossa');
            await this.aggiornaMonitorCommesse();
        } catch (error) {
            console.error('Errore modifica integrazione:', error);
            NotificationService.error('Errore durante la modifica');
        }
    }

    // ============================================================
    // 7.17 DIAGNOSTICA E DEBUG
    // ============================================================

    async diagnosticaCommesse() {
        try {
            const commesse = await this.pbService.getCollection("commesse");
            const report = {
                totale: commesse.length,
                conPreventivo: 0,
                senzaPreventivo: 0,
                conOreCalcolate: 0,
                senzaOreCalcolate: 0,
                conStato: 0,
                senzaStato: 0,
                problemi: []
            };

            commesse.forEach(c => {
                if (c.valorePreventivo > 0) report.conPreventivo++;
                else report.senzaPreventivo++;
                
                if (c.oreTotaliPreviste > 0) report.conOreCalcolate++;
                else report.senzaOreCalcolate++;
                
                if (c.stato) report.conStato++;
                else report.senzaStato++;

                if (c.valorePreventivo > 0 && !c.oreTotaliPreviste) {
                    report.problemi.push({ commessa: c.nomeCommessa, problema: 'Ha preventivo ma ore non calcolate' });
                }
                if (!c.stato) {
                    report.problemi.push({ commessa: c.nomeCommessa, problema: 'Manca stato' });
                }
            });

            this.mostraReportDiagnostica(report);
        } catch (error) {
            console.error('Errore diagnostica:', error);
            NotificationService.error('Errore durante la diagnostica');
        }
    }

    mostraReportDiagnostica(report) {
        const container = document.createElement('div');
        container.className = 'diagnostica-report';
        container.innerHTML = `
            <h5>🔍 Diagnostica Commesse</h5>
            <div class="row">
                <div class="col-md-3"><strong>Totale:</strong> ${report.totale}</div>
                <div class="col-md-3"><strong>Con preventivo:</strong> ${report.conPreventivo}</div>
                <div class="col-md-3"><strong>Ore calcolate:</strong> ${report.conOreCalcolate}</div>
                <div class="col-md-3"><strong>Con stato:</strong> ${report.conStato}</div>
            </div>
            ${report.problemi.length > 0 ? `
                <div class="mt-3">
                    <h6>⚠️ Problemi rilevati (${report.problemi.length}):</h6>
                    <ul>
                        ${report.problemi.slice(0, 10).map(p => `<li>${p.commessa}: ${p.problema}</li>`).join('')}
                        ${report.problemi.length > 10 ? `<li>... e altri ${report.problemi.length - 10} problemi</li>` : ''}
                    </ul>
                    <button class="btn btn-sm btn-success" id="btnCorreggiDiagnostica">
                        🔧 Correggi Automaticamente
                    </button>
                </div>
            ` : `
                <div class="mt-3 alert alert-success">✅ Tutte le commesse sono configurate correttamente!</div>
            `}
            <button class="btn btn-sm btn-secondary mt-2" onclick="this.parentElement.remove()">❌ Chiudi</button>
        `;

        document.body.appendChild(container);

        document.getElementById('btnCorreggiDiagnostica')?.addEventListener('click', async () => {
            await this.correggiCommesseEsistenti();
            container.remove();
            NotificationService.success('Correzione completata!');
        });
    }

    async debugCommesse() {
        try {
            const commesse = await this.pbService.getCollection("commesse");
            console.log('=== DEBUG COMMESSE ===');
            commesse.forEach((c, i) => {
                console.log(`${i + 1}. ${c.nomeCommessa}:`, {
                    id: c.id,
                    preventivo: c.valorePreventivo,
                    orePreviste: c.oreTotaliPreviste,
                    stato: c.stato
                });
            });
            
            const conPreventivo = commesse.filter(c => c.valorePreventivo > 0).length;
            const senzaPreventivo = commesse.filter(c => !c.valorePreventivo || c.valorePreventivo <= 0).length;
            
            NotificationService.info(`Debug:\nCon preventivo: ${conPreventivo}\nSenza: ${senzaPreventivo}\nTotale: ${commesse.length}`);
        } catch (error) {
            console.error('Errore debug:', error);
        }
    }

    async correggiCommesseEsistenti() {
        try {
            const commesse = await this.pbService.getCollection("commesse");
            let corrette = 0;

            for (const c of commesse) {
                let needsUpdate = false;
                const update = {};

                if (c.valorePreventivo && c.valorePreventivo > 0) {
                    const ore = c.valorePreventivo / CONFIG.TARIFFA_ORARIA;
                    if (!c.oreTotaliPreviste || c.oreTotaliPreviste === 0) {
                        update.oreTotaliPreviste = parseFloat(ore.toFixed(2));
                        needsUpdate = true;
                    }
                }

                if (!c.stato) {
                    update.stato = 'attiva';
                    needsUpdate = true;
                }

                if (needsUpdate) {
                    await this.pbService.updateDocument("commesse", c.id, update);
                    corrette++;
                }
            }

            if (corrette > 0) {
                NotificationService.success(`${corrette} commesse corrette!`);
                await this.aggiornaMonitorCommesse();
            }
        } catch (error) {
            console.error('Errore correzione:', error);
        }
    }

    // ============================================================
    // 7.18 GRAFICI DASHBOARD
    // ============================================================

    async creaGraficiDashboard() {
        if (typeof Chart === 'undefined') {
            console.warn('Chart.js non caricato');
            return;
        }

        try {
            const [commesse, tutteLeOre, dipendenti] = await Promise.all([
                this.pbService.getCollection("commesse"),
                this.pbService.getCollection("oreLavorate"),
                this.pbService.getCollection("dipendenti")
            ]);

            this.popolaAnniFiltriGrafici();
            await this.creaGraficoMargini(commesse, tutteLeOre);
            this.creaGraficoStato(commesse);
            await this.creaGraficoOreDipendenti(tutteLeOre, dipendenti);
            this.creaGraficoAndamentoMensile(tutteLeOre, commesse);

        } catch (error) {
            console.error('Errore creazione grafici:', error);
            NotificationService.error('Errore nella creazione dei grafici');
        }
    }

    async creaGraficoMargini(commesse, tutteLeOre) {
        const canvas = document.getElementById('chartMarginiCommesse');
        if (!canvas) return;

        let commesseFiltrate = [...commesse];
        const filtroAnno = stateManager.filtri.margini.anno;
        const filtroMese = stateManager.filtri.margini.mese;

        if (filtroAnno) {
            commesseFiltrate = commesseFiltrate.filter(c => {
                const data = c.dataInizio || c.dataCreazione;
                return data && data.split('-')[0] === filtroAnno;
            });
        }

        if (filtroMese) {
            commesseFiltrate = commesseFiltrate.filter(c => {
                const data = c.dataInizio || c.dataCreazione;
                return data && data.split('-')[1] === filtroMese;
            });
        }

        const fornitori = stateManager.datiTotali.fornitori || [];
        const margini = [];

        for (const c of commesseFiltrate) {
            if (!c.nomeCommessa) continue;
            const stats = this.calcolaStatisticheCommessa(c, tutteLeOre, fornitori);
            if (stats.datiCompleti) {
                margini.push({
                    nome: c.nomeCommessa,
                    margine: stats.marginePercentuale,
                    preventivo: stats.valorePreventivo,
                    ricavo: stats.ricavoTotale
                });
            }
        }

        margini.sort((a, b) => b.margine - a.margine);
        stateManager.tuttiMargini = margini;

        const infoEl = document.getElementById('infoFiltriMargini');
        if (infoEl) {
            let testo = '';
            if (filtroAnno) testo += `Anno: ${filtroAnno} `;
            if (filtroMese) {
                const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
                testo += `Mese: ${mesi[parseInt(filtroMese) - 1]}`;
            }
            infoEl.textContent = testo || 'Tutti i dati';
        }

        this.disegnaGraficoMargini();
    }

    disegnaGraficoMargini() {
        const canvas = document.getElementById('chartMarginiCommesse');
        if (!canvas) return;

        if (this.grafici.margini) {
            this.grafici.margini.destroy();
        }

        const start = (stateManager.pagineGrafici.margini - 1) * CONFIG.ELEMENTI_GRAFICI_PER_PAGINA;
        const end = start + CONFIG.ELEMENTI_GRAFICI_PER_PAGINA;
        const dati = stateManager.tuttiMargini.slice(start, end);

        const totalPages = Math.ceil(stateManager.tuttiMargini.length / CONFIG.ELEMENTI_GRAFICI_PER_PAGINA);

        const info = document.getElementById('paginaMarginiInfo');
        if (info) {
            info.textContent = `Pagina ${stateManager.pagineGrafici.margini} / ${totalPages || 1} (${stateManager.tuttiMargini.length} totali)`;
        }

        document.getElementById('btnPrecMargini').disabled = stateManager.pagineGrafici.margini === 1;
        document.getElementById('btnSuccMargini').disabled = stateManager.pagineGrafici.margini === totalPages || totalPages === 0;

        if (dati.length === 0) {
            this.mostraMessaggioGraficoVuoto(canvas, 'Nessun margine disponibile');
            return;
        }

        const colori = dati.map(item => {
            const m = item.margine;
            if (m >= 30) return 'rgba(22, 163, 74, 0.8)';
            if (m >= 20) return 'rgba(8, 145, 178, 0.8)';
            if (m >= 10) return 'rgba(234, 179, 8, 0.8)';
            if (m >= 0) return 'rgba(251, 146, 60, 0.8)';
            return 'rgba(220, 38, 38, 0.8)';
        });

        const ctx = canvas.getContext('2d');
        this.grafici.margini = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dati.map(item => item.nome.length > 20 ? item.nome.substring(0, 17) + '...' : item.nome),
                datasets: [{
                    label: 'Margine (%)',
                    data: dati.map(item => Math.min(100, Math.max(-50, item.margine))),
                    backgroundColor: colori,
                    borderColor: colori.map(c => c.replace('0.8', '1')),
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const item = dati[ctx.dataIndex];
                                return [
                                    `Margine: ${item.margine.toFixed(1)}%`,
                                    `Preventivo: € ${item.preventivo.toFixed(2)}`,
                                    `Ricavo: € ${item.ricavo.toFixed(2)}`
                                ];
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        title: { display: true, text: 'Margine (%)' },
                        ticks: { callback: v => v + '%', stepSize: 20 },
                        min: -50,
                        max: 100
                    },
                    x: {
                        ticks: { maxRotation: 35, minRotation: 35, autoSkip: false, font: { size: 10 } }
                    }
                }
            }
        });
    }

    creaGraficoStato(commesse) {
        const canvas = document.getElementById('chartStatoCommesse');
        if (!canvas) return;

        if (this.grafici.stato) {
            this.grafici.stato.destroy();
        }

        const attive = commesse.filter(c => c.stato === 'attiva' || !c.stato).length;
        const concluse = commesse.filter(c => c.stato === 'conclusa').length;

        const ctx = canvas.getContext('2d');
        this.grafici.stato = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: [`Attive (${attive})`, `Concluse (${concluse})`],
                datasets: [{
                    data: [attive, concluse],
                    backgroundColor: ['rgba(22, 163, 74, 0.8)', 'rgba(100, 116, 139, 0.8)'],
                    borderColor: ['#16a34a', '#64748b'],
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const total = attive + concluse;
                                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                                return `${ctx.label}: ${ctx.raw} (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    async creaGraficoOreDipendenti(tutteLeOre, dipendenti) {
        const canvas = document.getElementById('chartOreDipendenti');
        if (!canvas) return;

        let oreFiltrate = tutteLeOre;
        const filtroAnno = stateManager.filtri.oreDipendenti.anno;
        const filtroMese = stateManager.filtri.oreDipendenti.mese;

        if (filtroAnno) {
            oreFiltrate = oreFiltrate.filter(o => o.data && o.data.split('-')[0] === filtroAnno);
        }
        if (filtroMese) {
            oreFiltrate = oreFiltrate.filter(o => o.data && o.data.split('-')[1] === filtroMese);
        }

        const orePerDipendente = {};
        dipendenti.forEach(d => {
            orePerDipendente[`${d.nome} ${d.cognome}`] = 0;
        });

        oreFiltrate.forEach(o => {
            const nome = `${o.nomeDipendente} ${o.cognomeDipendente}`;
            if (orePerDipendente[nome] !== undefined) {
                orePerDipendente[nome] += Utils.calcolaOreLavorate(o.oraInizio, o.oraFine);
            }
        });

        const sorted = Object.entries(orePerDipendente)
            .filter(([_, ore]) => ore > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([nome, ore]) => ({ nome, ore: parseFloat(ore.toFixed(1)) }));

        stateManager.tutteOreDipendenti = sorted;

        const infoEl = document.getElementById('infoFiltriOreDipendenti');
        if (infoEl) {
            let testo = '';
            if (filtroAnno) testo += `Anno: ${filtroAnno} `;
            if (filtroMese) {
                const mesi = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
                testo += `Mese: ${mesi[parseInt(filtroMese) - 1]}`;
            }
            infoEl.textContent = testo || 'Tutti i dati';
        }

        this.disegnaGraficoOreDipendenti();
    }

    disegnaGraficoOreDipendenti() {
        const canvas = document.getElementById('chartOreDipendenti');
        if (!canvas) return;

        if (this.grafici.oreDipendenti) {
            this.grafici.oreDipendenti.destroy();
        }

        const start = (stateManager.pagineGrafici.oreDipendenti - 1) * CONFIG.ELEMENTI_GRAFICI_PER_PAGINA;
        const end = start + CONFIG.ELEMENTI_GRAFICI_PER_PAGINA;
        const dati = stateManager.tutteOreDipendenti.slice(start, end);

        const totalPages = Math.ceil(stateManager.tutteOreDipendenti.length / CONFIG.ELEMENTI_GRAFICI_PER_PAGINA);

        const info = document.getElementById('paginaOreDipendentiInfo');
        if (info) {
            info.textContent = `Pagina ${stateManager.pagineGrafici.oreDipendenti} / ${totalPages || 1} (${stateManager.tutteOreDipendenti.length} dipendenti)`;
        }

        document.getElementById('btnPrecOreDipendenti').disabled = stateManager.pagineGrafici.oreDipendenti === 1;
        document.getElementById('btnSuccOreDipendenti').disabled = stateManager.pagineGrafici.oreDipendenti === totalPages || totalPages === 0;

        if (dati.length === 0) {
            this.mostraMessaggioGraficoVuoto(canvas, 'Nessuna ora lavorata');
            return;
        }

        const ctx = canvas.getContext('2d');
        this.grafici.oreDipendenti = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: dati.map(item => item.nome.length > 20 ? item.nome.substring(0, 17) + '...' : item.nome),
                datasets: [{
                    label: 'Ore Lavorate',
                    data: dati.map(item => item.ore),
                    backgroundColor: 'rgba(37, 99, 235, 0.7)',
                    borderColor: 'rgba(37, 99, 235, 1)',
                    borderWidth: 1,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const ore = ctx.raw;
                                return `${Utils.formattaOreDecimali(ore)} ore (${ore.toFixed(1)}h)`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        title: { display: true, text: 'Ore Lavorate' },
                        beginAtZero: true,
                        ticks: { callback: v => Utils.formattaOreDecimali(v) }
                    },
                    x: {
                        ticks: { maxRotation: 35, minRotation: 35, autoSkip: false, font: { size: 10 } }
                    }
                }
            }
        });
    }

    creaGraficoAndamentoMensile(tutteLeOre, commesse) {
        const canvas = document.getElementById('chartAndamentoMensile');
        if (!canvas) return;

        if (this.grafici.andamento) {
            this.grafici.andamento.destroy();
        }

        const anni = {};
        const annoCorrente = new Date().getFullYear();

        tutteLeOre.forEach(o => {
            if (o.data) {
                const [anno, mese] = o.data.split('-');
                if (!anni[anno]) anni[anno] = new Array(12).fill(0);
                const ore = Utils.calcolaOreLavorate(o.oraInizio, o.oraFine);
                anni[anno][parseInt(mese) - 1] += ore;
            }
        });

        const anniDisponibili = Object.keys(anni).sort();
        const annoSelezionato = anniDisponibili.includes(String(annoCorrente)) ? 
                               String(annoCorrente) : 
                               anniDisponibili[anniDisponibili.length - 1] || String(annoCorrente);

        const oreLavorate = anni[annoSelezionato] || new Array(12).fill(0);

        const orePreventivate = new Array(12).fill(0);
        commesse.forEach(c => {
            const data = c.dataInizio || c.dataCreazione;
            if (data && c.valorePreventivo > 0) {
                const [anno, mese] = data.split('-');
                if (anno === annoSelezionato) {
                    const meseIndex = parseInt(mese) - 1;
                    if (meseIndex >= 0 && meseIndex < 12) {
                        orePreventivate[meseIndex] += parseFloat(c.oreTotaliPreviste) || 0;
                    }
                }
            }
        });

        const dataLavorate = oreLavorate.map(o => parseFloat(o.toFixed(1)));
        const dataPreventivate = orePreventivate.map(o => parseFloat(o.toFixed(1)));

        const hasData = dataLavorate.some(o => o > 0) || dataPreventivate.some(o => o > 0);
        if (!hasData) {
            this.mostraMessaggioGraficoVuoto(canvas, `Nessun dato per ${annoSelezionato}`);
            return;
        }

        const ctx = canvas.getContext('2d');
        this.grafici.andamento = new Chart(ctx, {
            type: 'line',
            data: {
                labels: CONFIG.MESI_ABBREVIATI,
                datasets: [
                    {
                        label: `Ore Lavorate ${annoSelezionato}`,
                        data: dataLavorate,
                        borderColor: 'rgba(22, 163, 74, 1)',
                        backgroundColor: 'rgba(22, 163, 74, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.3,
                        pointBackgroundColor: 'rgba(22, 163, 74, 1)',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    },
                    {
                        label: `Ore Preventivate ${annoSelezionato}`,
                        data: dataPreventivate,
                        borderColor: 'rgba(37, 99, 235, 1)',
                        backgroundColor: 'rgba(37, 99, 235, 0.05)',
                        borderWidth: 3,
                        borderDash: [8, 4],
                        fill: false,
                        tension: 0.3,
                        pointBackgroundColor: 'rgba(37, 99, 235, 1)',
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { 
                        position: 'top',
                        labels: { usePointStyle: true, boxWidth: 10 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw;
                                return `${ctx.dataset.label}: ${Utils.formattaOreDecimali(val)} ore`;
                            },
                            footer: (items) => {
                                const lav = items.find(i => i.dataset.label.includes('Lavorate'));
                                const prev = items.find(i => i.dataset.label.includes('Preventivate'));
                                if (lav && prev) {
                                    const diff = lav.raw - prev.raw;
                                    if (diff > 0) return `📈 Eccedenza: +${Utils.formattaOreDecimali(diff)} ore`;
                                    if (diff < 0) return `📉 Sottoutilizzo: ${Utils.formattaOreDecimali(Math.abs(diff))} ore`;
                                    return '✓ In linea con il preventivo';
                                }
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: v => Utils.formattaOreDecimali(v) },
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    x: {
                        grid: { display: false }
                    }
                }
            }
        });

        this.aggiungiSommarioAndamento(dataLavorate, dataPreventivate, annoSelezionato);
    }

    aggiungiSommarioAndamento(lavorate, preventivate, anno) {
        const container = document.getElementById('summaryAndamento');
        if (!container) return;

        const totLav = lavorate.reduce((a, b) => a + b, 0);
        const totPrev = preventivate.reduce((a, b) => a + b, 0);
        const diff = totLav - totPrev;
        const pct = totPrev > 0 ? (totLav / totPrev) * 100 : 0;

        const diffClass = diff > 0 ? 'text-success' : (diff < 0 ? 'text-danger' : 'text-muted');
        const diffText = diff > 0 ? 'Eccedenza' : (diff < 0 ? 'Sottoutilizzo' : 'In linea');

        container.innerHTML = `
            <div class="d-flex justify-content-around flex-wrap gap-2 p-2 bg-light rounded">
                <span><strong>📊 Totale Lavorate:</strong> ${Utils.formattaOreDecimali(totLav)} ore</span>
                <span><strong>📋 Totale Preventivate:</strong> ${Utils.formattaOreDecimali(totPrev)} ore</span>
                <span class="${diffClass}"><strong>${diffText}:</strong> ${Utils.formattaOreDecimali(Math.abs(diff))} ore (${pct.toFixed(1)}%)</span>
                <span class="text-muted"><small>Anno ${anno}</small></span>
            </div>
        `;
    }

    mostraMessaggioGraficoVuoto(canvas, messaggio) {
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        ctx.scale(2, 2);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '14px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(messaggio || 'Nessun dato disponibile', rect.width / 2, rect.height / 2);
    }

    // ============================================================
    // 7.19 FILTRI GRAFICI
    // ============================================================

    async applicaFiltriMarginiGrafico() {
        stateManager.filtri.margini.anno = document.getElementById('filtroAnnoMargini').value || '';
        stateManager.filtri.margini.mese = document.getElementById('filtroMeseMargini').value || '';
        stateManager.pagineGrafici.margini = 1;
        
        const [commesse, ore] = await Promise.all([
            this.pbService.getCollection("commesse"),
            this.pbService.getCollection("oreLavorate")
        ]);
        await this.creaGraficoMargini(commesse, ore);
        NotificationService.info('Filtri margini applicati');
    }

    resetFiltriMarginiGrafico() {
        document.getElementById('filtroAnnoMargini').value = '';
        document.getElementById('filtroMeseMargini').value = '';
        stateManager.filtri.margini = { anno: '', mese: '' };
        stateManager.pagineGrafici.margini = 1;
        this.creaGraficiDashboard();
        NotificationService.info('Filtri margini resettati');
    }

    async applicaFiltriOreDipendentiGrafico() {
        stateManager.filtri.oreDipendenti.anno = document.getElementById('filtroAnnoOreDipendenti').value || '';
        stateManager.filtri.oreDipendenti.mese = document.getElementById('filtroMeseOreDipendenti').value || '';
        stateManager.pagineGrafici.oreDipendenti = 1;
        
        const [ore, dipendenti] = await Promise.all([
            this.pbService.getCollection("oreLavorate"),
            this.pbService.getCollection("dipendenti")
        ]);
        await this.creaGraficoOreDipendenti(ore, dipendenti);
        NotificationService.info('Filtri ore dipendenti applicati');
    }

    resetFiltriOreDipendentiGrafico() {
        document.getElementById('filtroAnnoOreDipendenti').value = '';
        document.getElementById('filtroMeseOreDipendenti').value = '';
        stateManager.filtri.oreDipendenti = { anno: '', mese: '' };
        stateManager.pagineGrafici.oreDipendenti = 1;
        this.creaGraficiDashboard();
        NotificationService.info('Filtri ore dipendenti resettati');
    }

    // ============================================================
    // 7.20 PAGINAZIONE GRAFICI
    // ============================================================

    paginaMarginiPrec() {
        if (stateManager.pagineGrafici.margini > 1) {
            stateManager.pagineGrafici.margini--;
            this.disegnaGraficoMargini();
        }
    }

    paginaMarginiSucc() {
        const total = Math.ceil(stateManager.tuttiMargini.length / CONFIG.ELEMENTI_GRAFICI_PER_PAGINA);
        if (stateManager.pagineGrafici.margini < total) {
            stateManager.pagineGrafici.margini++;
            this.disegnaGraficoMargini();
        }
    }

    paginaOreDipendentiPrec() {
        if (stateManager.pagineGrafici.oreDipendenti > 1) {
            stateManager.pagineGrafici.oreDipendenti--;
            this.disegnaGraficoOreDipendenti();
        }
    }

    paginaOreDipendentiSucc() {
        const total = Math.ceil(stateManager.tutteOreDipendenti.length / CONFIG.ELEMENTI_GRAFICI_PER_PAGINA);
        if (stateManager.pagineGrafici.oreDipendenti < total) {
            stateManager.pagineGrafici.oreDipendenti++;
            this.disegnaGraficoOreDipendenti();
        }
    }

    // ============================================================
    // 7.21 ESPORTAZIONE GRAFICI
    // ============================================================

    async esportaGraficiPNG() {
        try {
            const canvas = document.getElementById('chartMarginiCommesse');
            if (!canvas) {
                NotificationService.error('Nessun grafico da esportare');
                return;
            }

            const link = document.createElement('a');
            link.download = `dashboard_grafici_${new Date().toISOString().split('T')[0]}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            
            NotificationService.success('Grafici esportati con successo!');
        } catch (error) {
            console.error('Errore esportazione:', error);
            NotificationService.error('Errore durante l\'esportazione');
        }
    }

    // ============================================================
    // 7.22 REPORT MENSILE
    // ============================================================

    async mostraTabellaMensile() {
        const meseSelect = document.getElementById('selettoreMese');
        const mese = parseInt(meseSelect.value);
        const nomeMese = CONFIG.MESI[mese];
        
        const container = document.getElementById('tabelleMensili');
        container.style.display = 'block';
        container.innerHTML = `<div class="text-center py-4"><i class="fas fa-spinner fa-spin fa-2x"></i><br>Caricamento...</div>`;

        try {
            await this.generaTabellaMensile(mese + 1, nomeMese);
        } catch (error) {
            console.error('Errore report mensile:', error);
            container.innerHTML = `<div class="alert alert-danger">Errore nel caricamento del report</div>`;
        }
    }

    async generaTabellaMensile(meseNumero, nomeMese) {
        const container = document.getElementById('tabelleMensili');
        const datiOre = await this.pbService.getCollection("oreLavorate");
        
        const datiPerDipendente = {};
        const annoCorrente = new Date().getFullYear();

        datiOre.forEach(ore => {
            const data = new Date(ore.data);
            if (data.getMonth() + 1 === meseNumero && data.getFullYear() === annoCorrente) {
                const key = `${ore.nomeDipendente} ${ore.cognomeDipendente}`;
                if (!datiPerDipendente[key]) {
                    datiPerDipendente[key] = { giorni: new Array(31).fill(0), totale: 0 };
                }
                const giorno = data.getDate() - 1;
                const oreLav = Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
                datiPerDipendente[key].giorni[giorno] += oreLav;
                datiPerDipendente[key].totale += oreLav;
            }
        });

        let totaleGenerale = 0;
        const dipendentiConOre = Object.keys(datiPerDipendente).filter(nome => {
            const tot = datiPerDipendente[nome].totale;
            if (tot > 0) totaleGenerale += tot;
            return tot > 0;
        });

        const giorniNelMese = new Date(annoCorrente, meseNumero, 0).getDate();

        const dipendentiOrdinati = Object.entries(datiPerDipendente)
            .filter(([_, dati]) => dati.totale > 0)
            .sort((a, b) => b[1].totale - a[1].totale);

        let totaliGiorno = [];
        for (let i = 0; i < giorniNelMese; i++) {
            let tot = 0;
            Object.values(datiPerDipendente).forEach(d => {
                tot += d.giorni[i] || 0;
            });
            totaliGiorno.push(tot);
        }
        
        const totaleFinale = totaliGiorno.reduce((a, b) => a + b, 0);

        let html = `
            <div class="card mb-4">
                <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-2" style="background: linear-gradient(135deg, #0f172a, #1e293b); color: white;">
                    <div>
                        <h3 class="mb-0"><i class="fas fa-calendar-alt"></i> ${nomeMese} ${annoCorrente}</h3>
                        <small class="text-light opacity-75">
                            <i class="fas fa-users"></i> ${dipendentiConOre.length} dipendenti attivi • 
                            <i class="fas fa-clock"></i> ${Utils.formattaOreDecimali(totaleGenerale)} ore totali
                        </small>
                    </div>
                    <div class="d-flex gap-2 flex-wrap">
                        <button class="btn btn-success btn-sm" id="btnScaricaPDF-${meseNumero}">
                            <i class="fas fa-file-pdf"></i> Scarica PDF Report
                        </button>
                        <button class="btn btn-outline-light btn-sm" id="btnScaricaCSV-${meseNumero}">
                            <i class="fas fa-file-csv"></i> CSV
                        </button>
                    </div>
                </div>
                <div class="card-body" style="padding: 0; overflow-x: auto;">
                    <div class="table-responsive" style="max-height: 600px; overflow-y: auto;">
                        <table class="table table-bordered table-sm table-striped" style="margin: 0; font-size: 0.85rem;">
                            <thead style="position: sticky; top: 0; z-index: 10;">
                                <tr class="table-dark">
                                    <th style="min-width: 150px; position: sticky; left: 0; z-index: 11; background: #0f172a; color: white;">Dipendente</th>
                                    ${Array.from({ length: giorniNelMese }, (_, i) => {
                                        const data = new Date(annoCorrente, meseNumero - 1, i + 1);
                                        const giorniSettimana = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
                                        const giornoSett = giorniSettimana[data.getDay()];
                                        const isWeekend = giornoSett === 'Dom' || giornoSett === 'Sab';
                                        return `<th class="text-center ${isWeekend ? 'bg-secondary text-white' : ''}" style="min-width: 45px; font-size: 0.7rem;">${i + 1}<br><small>${giornoSett}</small></th>`;
                                    }).join('')}
                                    <th class="text-center" style="min-width: 80px; background: #1e293b; color: white;">Totale</th>
                                    <th class="text-center" style="min-width: 70px; background: #1e293b; color: white;">%</th>
                                    <th class="text-center" style="min-width: 80px; background: #1e293b; color: white;">Media/G</th>
                                    <th class="text-center" style="min-width: 60px; background: #1e293b; color: white;">Giorni</th>
                                </tr>
                            </thead>
                            <tbody>
        `;

        dipendentiOrdinati.forEach(([dipendente, dati], index) => {
            const totaleDipendente = dati.totale;
            const giorniLavorati = dati.giorni.filter(ore => ore > 0).length;
            const mediaGiornaliera = giorniLavorati > 0 ? totaleDipendente / giorniLavorati : 0;
            const percentuale = totaleGenerale > 0 ? (totaleDipendente / totaleGenerale) * 100 : 0;
            
            const colori = ['#f8fafc', '#ffffff', '#f1f5f9', '#e2e8f0'];
            const bgColor = colori[index % colori.length];
            
            html += `<tr style="background: ${bgColor};">`;
            html += `<td style="position: sticky; left: 0; z-index: 5; background: ${bgColor}; font-weight: 600; min-width: 150px;">
                        <i class="fas fa-user-circle text-primary"></i> ${dipendente}
                        ${index === 0 ? ' <span class="badge bg-warning text-dark">🏆 Top</span>' : ''}
                    </td>`;
            
            for (let i = 0; i < giorniNelMese; i++) {
                const ore = dati.giorni[i] || 0;
                const data = new Date(annoCorrente, meseNumero - 1, i + 1);
                const giorniSettimana = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
                const isWeekend = giorniSettimana[data.getDay()] === 'Dom' || giorniSettimana[data.getDay()] === 'Sab';
                
                if (ore > 0) {
                    const isOvertime = ore > 8;
                    const className = isOvertime ? 'text-danger fw-bold' : (isWeekend ? 'text-primary' : '');
                    html += `<td class="text-center ${className}" style="font-size: 0.8rem;">
                                ${Utils.formattaOreDecimali(ore)}
                                ${isOvertime ? '<sup style="color: #dc2626;">*</sup>' : ''}
                            </td>`;
                } else {
                    const isWeekendDay = isWeekend;
                    html += `<td class="text-center text-muted" style="font-size: 0.7rem; ${isWeekendDay ? 'background: #f1f5f9;' : ''}">
                                ${isWeekendDay ? '—' : ''}
                            </td>`;
                }
            }
            
            html += `<td class="text-center fw-bold" style="background: #dbeafe;">${Utils.formattaOreDecimali(totaleDipendente)}</td>`;
            html += `<td class="text-center">${percentuale.toFixed(1)}%</td>`;
            html += `<td class="text-center">${Utils.formattaOreDecimali(mediaGiornaliera)}</td>`;
            html += `<td class="text-center">${giorniLavorati}</td>`;
            html += `</tr>`;
        });

        if (dipendentiOrdinati.length > 0) {
            html += `<tr style="background: #0f172a; color: white; font-weight: bold;">`;
            html += `<td style="position: sticky; left: 0; z-index: 5; background: #0f172a; color: white;">
                        <i class="fas fa-calculator"></i> TOTALE
                    </td>`;
            
            for (let i = 0; i < giorniNelMese; i++) {
                const tot = totaliGiorno[i] || 0;
                html += `<td class="text-center" style="font-size: 0.8rem;">${tot > 0 ? Utils.formattaOreDecimali(tot) : ''}</td>`;
            }
            
            const mediaFinale = giorniNelMese > 0 ? totaleFinale / giorniNelMese : 0;
            const giorniLavoratiTotali = Object.values(datiPerDipendente).reduce((sum, d) => sum + d.giorni.filter(o => o > 0).length, 0);
            
            html += `<td class="text-center" style="background: #1e293b;">${Utils.formattaOreDecimali(totaleFinale)}</td>`;
            html += `<td class="text-center" style="background: #1e293b;">100%</td>`;
            html += `<td class="text-center" style="background: #1e293b;">${Utils.formattaOreDecimali(mediaFinale)}</td>`;
            html += `<td class="text-center" style="background: #1e293b;">${giorniLavoratiTotali}</td>`;
            html += `</tr>`;
        }

        html += `
                            </tbody>
                        </table>
                    </div>
                </div>
                <div class="card-footer bg-light">
                    <div class="row g-2">
                        <div class="col-md-6">
                            <small class="text-muted">
                                <i class="fas fa-info-circle"></i> 
                                <span class="text-danger">*</span> Ore oltre le 8h giornaliere
                                <span class="ms-3"><span class="badge bg-warning text-dark">🏆</span> Top performer del mese</span>
                            </small>
                        </div>
                        <div class="col-md-6 text-md-end">
                            <small class="text-muted">
                                <i class="fas fa-calendar-check"></i> ${giorniNelMese} giorni • 
                                <i class="fas fa-users"></i> ${dipendentiOrdinati.length} dipendenti • 
                                <i class="fas fa-clock"></i> ${Utils.formattaOreDecimali(totaleFinale)} ore totali
                            </small>
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        document.getElementById(`btnScaricaPDF-${meseNumero}`)?.addEventListener('click', () => {
            this.generaPDFMensile(nomeMese, meseNumero, datiPerDipendente, annoCorrente);
        });

        document.getElementById(`btnScaricaCSV-${meseNumero}`)?.addEventListener('click', () => {
            this.scaricaCSV(nomeMese, meseNumero, datiPerDipendente);
        });
    }

    async generaPDFMensile(nomeMese, meseNumero, datiPerDipendente, annoCorrente) {
        // ... (mantieni il codice esistente per generaPDFMensile)
        // È troppo lungo per essere ripetuto qui, ma va mantenuto invariato
    }

    async scaricaCSV(nomeMese, meseNumero, datiPerDipendente) {
        // ... (mantieni il codice esistente per scaricaCSV)
    }

    // ============================================================
    // 7.23 BACKUP DATI
    // ============================================================

    async eseguiBackupDati() {
        try {
            NotificationService.info('Generazione backup in corso...');

            const [commesse, dipendenti, oreLavorate, fornitori] = await Promise.all([
                this.pbService.getCollection("commesse"),
                this.pbService.getCollection("dipendenti"),
                this.pbService.getCollection("oreLavorate"),
                this.pbService.getCollection("fornitoriLavorazioni")
            ]);

            const backup = {
                metadata: {
                    versione: "2.0",
                    dataGenerazione: new Date().toISOString(),
                    autore: stateManager.currentUser?.email || "Sconosciuto",
                    conteggio: {
                        commesse: commesse.length,
                        dipendenti: dipendenti.length,
                        oreLavorate: oreLavorate.length,
                        fornitori: fornitori.length
                    }
                },
                dati: { commesse, dipendenti, oreLavorate, fornitori }
            };

            const json = JSON.stringify(backup, null, 2);
            const blob = new Blob([json], { type: "application/json" });
            
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `backup_union14_${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            URL.revokeObjectURL(link.href);

            localStorage.setItem('ultimoBackup', JSON.stringify({
                data: document.getElementById('oreData').value,
                utente: stateManager.currentUser?.email
            }));

            this.aggiornaInfoUltimoBackup();
            NotificationService.success('Backup completato con successo!');

        } catch (error) {
            console.error('Errore backup:', error);
            NotificationService.error('Errore durante il backup');
        }
    }

    async ripristinaDaBackup(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const backup = JSON.parse(text);

            if (!backup.dati || !backup.dati.commesse) {
                NotificationService.error('File backup non valido');
                return;
            }

            const confirmMsg = `⚠️ ATTENZIONE: Questa operazione SOSTITUIRÀ tutti i dati esistenti!\n\n` +
                `Backup del: ${new Date(backup.metadata.dataGenerazione).toLocaleString('it-IT')}\n` +
                `Commesse: ${backup.dati.commesse.length}\n` +
                `Dipendenti: ${backup.dati.dipendenti.length}\n` +
                `Ore lavorate: ${backup.dati.oreLavorate.length}\n` +
                `Fornitori: ${backup.dati.fornitori?.length || 0}\n\n` +
                `Sei sicuro di voler procedere?`;

            if (!confirm(confirmMsg)) return;

            NotificationService.info('Ripristino in corso...');

            const collezioni = ['commesse', 'dipendenti', 'oreLavorate', 'fornitoriLavorazioni'];
            for (const coll of collezioni) {
                const docs = await this.pbService.getCollection(coll);
                for (const doc of docs) {
                    await this.pbService.deleteDocument(coll, doc.id);
                }
            }

            for (const commessa of backup.dati.commesse) {
                delete commessa.id;
                await this.pbService.addDocument("commesse", commessa);
            }
            for (const dip of backup.dati.dipendenti) {
                delete dip.id;
                await this.pbService.addDocument("dipendenti", dip);
            }
            for (const ore of backup.dati.oreLavorate) {
                delete ore.id;
                await this.pbService.addDocument("oreLavorate", ore);
            }
            if (backup.dati.fornitori) {
                for (const f of backup.dati.fornitori) {
                    delete f.id;
                    await this.pbService.addDocument("fornitoriLavorazioni", f);
                }
            }

            stateManager.clearCache();
            await Promise.all([
                this.aggiornaTabellaCommesse(),
                this.aggiornaTabellaDipendenti(),
                this.aggiornaTabellaOreLavorate(),
                this.caricaFornitori(),
                this.aggiornaMonitorCommesse(),
                this.creaGraficiDashboard()
            ]);

            NotificationService.success('Ripristino completato con successo!');

        } catch (error) {
            console.error('Errore ripristino:', error);
            NotificationService.error('Errore durante il ripristino: ' + error.message);
        }
    }

    aggiornaInfoUltimoBackup() {
        const infoDiv = document.getElementById('infoUltimoBackup');
        if (!infoDiv) return;

        const ultimo = localStorage.getItem('ultimoBackup');
        if (ultimo) {
            const data = JSON.parse(ultimo);
            infoDiv.innerHTML = `<i class="fas fa-history"></i> Ultimo backup: ${new Date(data.data).toLocaleString('it-IT')} - ${data.utente}`;
        } else {
            infoDiv.innerHTML = '<i class="fas fa-clock"></i> Nessun backup precedente trovato';
        }
    }

    // ============================================================
    // 7.24 PDF
    // ============================================================

    async generaPDFFiltrato() {
    // 🔥 IMPEDISCI GENERAZIONI MULTIPLE
    if (this._generazionePDFInCorso) {
        console.log('⚠️ [PDF] Generazione già in corso, salto...');
        return;
    }
    
    this._generazionePDFInCorso = true;
    
    try {
        if (typeof window.jspdf === 'undefined') {
            await this.caricaLibreriePDF();
        }

        const { jsPDF } = window.jspdf;
        if (!jsPDF) {
            NotificationService.error('Librerie PDF non disponibili');
            this._generazionePDFInCorso = false;
            return;
        }

        // 🔥 1. PRENDI I DATI CORRETTI
        let dati = [];
        let fonteDati = '';
        
        if (stateManager.datiFiltrati && stateManager.datiFiltrati.length > 0) {
            dati = stateManager.datiFiltrati.slice();
            fonteDati = 'filtrati e ordinati';
        } else if (stateManager.datiTotali.oreLavorate && stateManager.datiTotali.oreLavorate.length > 0) {
            dati = stateManager.datiTotali.oreLavorate.slice();
            fonteDati = 'tutti';
        } else {
            const filtri = this.getFiltriOreAttivi();
            const hasFiltri = filtri.commessa || filtri.dipendente || 
                             filtri.anno || filtri.mese || filtri.giorno || 
                             filtri.nonConformita;
            
            if (!hasFiltri) {
                const oggi = new Date().toISOString().split('T')[0];
                filtri.anno = oggi.split('-')[0];
                filtri.mese = oggi.split('-')[1];
                filtri.giorno = oggi.split('-')[2];
            }
            
            dati = await this.pbService.getOreLavorateFiltrate(filtri);
            fonteDati = 'caricati';
        }

        if (!dati || dati.length === 0) {
            NotificationService.warning('Nessun dato da esportare');
            this._generazionePDFInCorso = false;
            return;
        }

        // 🔥 2. ORDINA I DATI
        if (!stateManager.datiFiltrati || stateManager.datiFiltrati.length === 0) {
            dati.sort((a, b) => {
                if (a.data !== b.data) return b.data.localeCompare(a.data);
                if (a.commessa !== b.commessa) return a.commessa.localeCompare(b.commessa, 'it');
                return a.oraInizio.localeCompare(b.oraInizio);
            });
        }

        // 🔥 3. CALCOLA STATISTICHE
        const totaleOre = this.calcolaTotaleGenerale(dati);
        const giorniUnici = new Set(dati.map(o => o.data)).size;
        const dipendentiUnici = new Set(dati.map(o => `${o.nomeDipendente} ${o.cognomeDipendente}`)).size;
        const nonConformita = dati.filter(o => o.nonConformita).length;
        const commesseUniche = new Set(dati.map(o => o.commessa)).size;

        // 🔥 4. PDF - ORIENTAMENTO LANDSCAPE PER PIÙ SPAZIO
        const doc = new jsPDF({ 
            orientation: 'landscape', 
            unit: 'mm', 
            format: 'a4' 
        });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        
        // ============================================
        // 5. INTESTAZIONE
        // ============================================
        doc.setFillColor(15, 23, 42);
        doc.rect(0, 0, pageWidth, 32, 'F');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('📋 REPORT ORE LAVORATE', pageWidth / 2, 14, { align: 'center' });
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, pageWidth / 2, 22, { align: 'center' });
        doc.text(`Record: ${dati.length}  •  ${fonteDati}`, pageWidth / 2, 28, { align: 'center' });

        // ============================================
        // 6. STATISTICHE RIASSUNTIVE
        // ============================================
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        
        const statsY = 38;
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(10, statsY, pageWidth - 20, 20, 2, 2, 'F');
        
        doc.setFont('helvetica', 'normal');
        const stats = [
            { label: '📅 Giorni Lavorati', value: giorniUnici },
            { label: '👥 Dipendenti', value: dipendentiUnici },
            { label: '📋 Commesse', value: commesseUniche },
            { label: '⏱️ Ore Totali', value: Utils.formattaOreDecimali(totaleOre) },
            { label: '⚠️ Non Conformità', value: nonConformita },
            { label: '📊 Media/Giorno', value: giorniUnici > 0 ? Utils.formattaOreDecimali(totaleOre / giorniUnici) : '0:00' }
        ];

        const colWidth = (pageWidth - 20) / stats.length;
        stats.forEach((stat, index) => {
            const x = 10 + (index * colWidth);
            doc.text(stat.label, x + 2, statsY + 6);
            doc.setFont('helvetica', 'bold');
            doc.text(stat.value.toString(), x + 2, statsY + 15);
            doc.setFont('helvetica', 'normal');
        });

        // ============================================
        // 7. TABELLA ESTESA CON DESCRIZIONI COMPLETE
        // ============================================
        
        // Prepara i dati con descrizioni complete (senza troncamento)
        const tableData = dati.map(ore => {
            const oreLav = Utils.calcolaOreLavorate(ore.oraInizio, ore.oraFine);
            const dataFormattata = Utils.formattaDataItaliana(ore.data);
            const nomeCompleto = `${ore.nomeDipendente || ''} ${ore.cognomeDipendente || ''}`.trim() || '-';
            
            // 🔥 DESCRIZIONE COMPLETA (senza tagli)
            const descrizione = ore.descrizione || '-';
            
            return [
                ore.commessa || '-',
                nomeCompleto,
                dataFormattata || '-',
                ore.oraInizio || '-',
                ore.oraFine || '-',
                descrizione,  // 🔥 DESCRIZIONE COMPLETA
                ore.nonConformita ? '⚠️ Sì' : '✓ No',
                Utils.formattaOreDecimali(oreLav)
            ];
        });

        // Aggiungi riga totale
        tableData.push([
            'TOTALE GENERALE',
            '',
            '',
            '',
            '',
            '',
            '',
            Utils.formattaOreDecimali(totaleOre)
        ]);

        // 🔥 CALCOLA LARGHEZZE COLONNE PER SFRUTTARE TUTTO IL FOGLIO
        const marginX = 8;
        const tableWidth = pageWidth - (marginX * 2);
        
        // Distribuzione percentuale delle colonne
        const colWidths = {
            0: 22,   // Commessa
            1: 24,   // Dipendente
            2: 18,   // Data
            3: 14,   // Inizio
            4: 14,   // Fine
            5: 55,   // 🔥 DESCRIZIONE (la più larga!)
            6: 16,   // NC
            7: 18    // Ore
        };
        
        // Verifica che la somma non superi la larghezza disponibile
        let totalColWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);
        if (totalColWidth > tableWidth) {
            // Riduci proporzionalmente la descrizione
            const diff = totalColWidth - tableWidth;
            colWidths[5] = Math.max(30, colWidths[5] - diff);
        }

        doc.autoTable({
            startY: statsY + 26,
            head: [['Commessa', 'Dipendente', 'Data', 'Inizio', 'Fine', 'Descrizione', 'NC', 'Ore']],
            body: tableData,
            theme: 'grid',
            styles: { 
                fontSize: 7, 
                cellPadding: 2.5,
                valign: 'middle',
                lineWidth: 0.1
            },
            headStyles: { 
                fillColor: [15, 23, 42], 
                textColor: [255, 255, 255],
                fontSize: 8,
                fontStyle: 'bold',
                halign: 'center'
            },
            columnStyles: {
                0: { cellWidth: colWidths[0], fontStyle: 'bold', halign: 'left' },
                1: { cellWidth: colWidths[1], halign: 'left' },
                2: { cellWidth: colWidths[2], halign: 'center' },
                3: { cellWidth: colWidths[3], halign: 'center' },
                4: { cellWidth: colWidths[4], halign: 'center' },
                5: { 
                    cellWidth: colWidths[5], 
                    halign: 'left',
                    fontSize: 6.5,  // 🔥 FONT PIÙ PICCOLO PER LA DESCRIZIONE
                    cellPadding: 2
                },
                6: { cellWidth: colWidths[6], halign: 'center' },
                7: { cellWidth: colWidths[7], halign: 'center', fontStyle: 'bold' }
            },
            didParseCell: (data) => {
                // Evidenzia la riga totale
                if (data.row.index === tableData.length - 1) {
                    data.cell.styles.fillColor = [15, 23, 42];
                    data.cell.styles.textColor = [255, 255, 255];
                    data.cell.styles.fontStyle = 'bold';
                    data.cell.styles.fontSize = 7.5;
                }
                // Evidenzia le non conformità
                if (data.column.index === 6 && data.cell.raw === '⚠️ Sì') {
                    data.cell.styles.textColor = [234, 179, 8];
                    data.cell.styles.fontStyle = 'bold';
                }
                // Colora le ore in base al valore
                if (data.column.index === 7 && data.row.index < tableData.length - 1) {
                    const oreStr = data.cell.raw;
                    if (oreStr) {
                        const ore = parseFloat(oreStr.replace(':', '.'));
                        if (ore > 8) {
                            data.cell.styles.textColor = [220, 38, 38];
                            data.cell.styles.fontStyle = 'bold';
                        } else if (ore >= 6) {
                            data.cell.styles.textColor = [22, 163, 74];
                        }
                    }
                }
                // 🔥 PERMETTI IL WRAPPING DEL TESTO NELLA DESCRIZIONE
                if (data.column.index === 5) {
                    data.cell.styles.cellWidth = 'auto';
                }
            },
            // 🔥 PERMETTI RIGHE PIÙ ALTE PER DESCRIZIONI LUNGHE
            didDrawCell: (data) => {
                if (data.column.index === 5 && data.cell.raw && data.cell.raw.length > 30) {
                    // La riga si adatterà automaticamente all'altezza del testo
                }
            }
        });

        // ============================================
        // 8. PIÈ DI PAGINA ESTESO
        // ============================================
        const finalY = Math.min(doc.lastAutoTable.finalY + 10, pageHeight - 20);
        
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(10, finalY, pageWidth - 20, 14, 2, 2, 'F');
        
        doc.setFontSize(7);
        doc.setTextColor(50, 50, 50);
        doc.text(`📊 Riepilogo: ${dati.length} record • ${Utils.formattaOreDecimali(totaleOre)} ore totali • ${giorniUnici} giorni • ${dipendentiUnici} dipendenti`, 15, finalY + 5);
        
        // Legenda estesa
        doc.setTextColor(100, 100, 100);
        doc.text('Legenda:', 15, finalY + 10);
        
        // Ore > 8h
        doc.setTextColor(220, 38, 38);
        doc.text('●', 15 + 20, finalY + 9.5);
        doc.setTextColor(100, 100, 100);
        doc.text('Ore > 8h', 15 + 26, finalY + 10);
        
        // Non Conformità
        doc.setTextColor(234, 179, 8);
        doc.text('●', 15 + 55, finalY + 9.5);
        doc.setTextColor(100, 100, 100);
        doc.text('Non Conformità', 15 + 61, finalY + 10);
        
        // Ore ≥ 6h
        doc.setTextColor(22, 163, 74);
        doc.text('●', 15 + 95, finalY + 9.5);
        doc.setTextColor(100, 100, 100);
        doc.text('Ore ≥ 6h', 15 + 101, finalY + 10);
        
        // Filtri attivi
        const filtriAttivi = this.getFiltriAttiviTesto();
        if (filtriAttivi) {
            doc.setTextColor(100, 100, 100);
            doc.text(`🔍 Filtri: ${filtriAttivi}`, 15 + 145, finalY + 10);
        }

        // Copyright
        doc.setFontSize(6);
        doc.setTextColor(150, 150, 150);
        doc.text(`Union14 - Sistema Gestione Ore Lavorative v2.0  •  ${new Date().toLocaleString('it-IT')}`, 
                pageWidth - 10, finalY + 10, { align: 'right' });

        // ============================================
        // 9. SALVA PDF
        // ============================================
        const nomeFile = `ore_lavorate_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(nomeFile);
        
        NotificationService.success(`📄 PDF generato con ${dati.length} record (${fonteDati})!`);

    } catch (error) {
        console.error('❌ Errore PDF:', error);
        NotificationService.error('Errore durante la generazione PDF: ' + error.message);
    } finally {
        this._generazionePDFInCorso = false;
        console.log('✅ [PDF] Generazione completata, flag resettato');
    }
}

    getFiltriAttiviTesto() {
        const filtri = [];
        
        const commessa = document.getElementById('filtroCommessa')?.value?.trim();
        if (commessa) filtri.push(`Commessa: "${commessa}"`);
        
        const dipendente = document.getElementById('filtroDipendente')?.value?.trim();
        if (dipendente) filtri.push(`Dipendente: "${dipendente}"`);
        
        const anno = document.getElementById('filtroAnno')?.value;
        if (anno) filtri.push(`Anno: ${anno}`);
        
        const mese = document.getElementById('filtroMese')?.value;
        if (mese) {
            const mesi = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                         'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
            filtri.push(`Mese: ${mesi[parseInt(mese) - 1]}`);
        }
        
        const giorno = document.getElementById('filtroGiorno')?.value;
        if (giorno) filtri.push(`Giorno: ${giorno}`);
        
        const nonConformita = document.getElementById('filtroNonConformita')?.checked;
        if (nonConformita) filtri.push('Solo non conformità');
        
        return filtri.length > 0 ? filtri.join(' • ') : '';
    }

      async generaPDFRubricaDipendenti() {
        try {
            if (typeof window.jspdf === 'undefined') {
                await this.caricaLibreriePDF();
            }

            const { jsPDF } = window.jspdf;
            if (!jsPDF) {
                NotificationService.error('Librerie PDF non disponibili');
                return;
            }

            const dipendenti = await this.pbService.getCollection("dipendenti");
            if (!dipendenti || dipendenti.length === 0) {
                NotificationService.warning('Nessun dipendente trovato');
                return;
            }

            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            
            doc.setFontSize(20);
            doc.setTextColor(37, 99, 235);
            doc.text('RUBRICA DIPENDENTI', 105, 20, { align: 'center' });
            doc.setFontSize(10);
            doc.setTextColor(100, 100, 100);
            doc.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, 105, 28, { align: 'center' });
            doc.text(`Totale: ${dipendenti.length} dipendenti`, 105, 34, { align: 'center' });

            const tableData = dipendenti.map(d => [
                `${d.nome} ${d.cognome}`,
                d.email,
                d.ruolo || 'dipendente'
            ]);

            doc.autoTable({
                startY: 40,
                head: [['Nome Completo', 'Email', 'Ruolo']],
                body: tableData,
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 4 },
                headStyles: { fillColor: [37, 99, 235], textColor: 255 }
            });

            doc.save(`rubrica_dipendenti_${new Date().toISOString().split('T')[0]}.pdf`);
            NotificationService.success('PDF rubrica generato con successo!');

        } catch (error) {
            console.error('Errore PDF rubrica:', error);
            NotificationService.error('Errore durante la generazione PDF');
        }
    }

    async generaPDFMonitoraggio() {
    try {
        if (typeof window.jspdf === 'undefined') {
            await this.caricaLibreriePDF();
        }

        const { jsPDF } = window.jspdf;
        if (!jsPDF) {
            NotificationService.error('Librerie PDF non disponibili');
            return;
        }

        // 🔥 RECUPERA I DATI CON GLI STESSI FILTRI DEL MONITORAGGIO
        const [commesse, tutteLeOre] = await Promise.all([
    this.pbService.getCollection("commesse"),
    this.pbService.getCollection("oreLavorate")
]);;

        // 🔥 APPLICA GLI STESSI FILTRI DELLA TABELLA
        const filtroNome = document.getElementById('filtroNomeCommessa')?.value?.trim() || '';
        const filtroStato = document.getElementById('filtroCommessaMonitor')?.value || '';
        const filtroAnno = document.getElementById('filtroAnnoMonitor')?.value || '';
        const filtroMese = document.getElementById('filtroMeseMonitor')?.value || '';
        const filtroFatturato = document.getElementById('filtroFatturato')?.value || '';

        let commesseFiltrate = commesse.filter(c => c && c.nomeCommessa);

        // Filtro nome
        if (filtroNome) {
            const f = filtroNome.toLowerCase();
            commesseFiltrate = commesseFiltrate.filter(c => 
                c.nomeCommessa.toLowerCase().includes(f)
            );
        }

        // Filtro stato
        if (filtroStato === 'attive') {
            commesseFiltrate = commesseFiltrate.filter(c => c.stato === 'attiva' || !c.stato);
        } else if (filtroStato === 'concluse') {
            commesseFiltrate = commesseFiltrate.filter(c => c.stato === 'conclusa');
        }

        // Filtro anno
        if (filtroAnno) {
            commesseFiltrate = commesseFiltrate.filter(c => {
                const data = c.dataInizio || c.dataCreazione;
                return data && data.split('-')[0] === filtroAnno;
            });
        }

        // Filtro mese
        if (filtroMese) {
            commesseFiltrate = commesseFiltrate.filter(c => {
                const data = c.dataInizio || c.dataCreazione;
                return data && data.split('-')[1] === filtroMese;
            });
        }

        // Filtro fatturato
        if (filtroFatturato) {
            commesseFiltrate = commesseFiltrate.filter(c => 
                (c.fatturato || 'da_fatturare') === filtroFatturato
            );
        }

        if (commesseFiltrate.length === 0) {
            NotificationService.warning('Nessuna commessa trovata con i filtri selezionati');
            return;
        }

        // 🔥 CALCOLA LE STATISTICHE PER LE COMMESSE FILTRATE
        const fornitori = stateManager.datiTotali.fornitori || [];
        const tableData = [];
        let totalePreventivo = 0;
        let totaleCosto = 0;
        let totaleMargine = 0;

        for (const c of commesseFiltrate) {
            const stats = this.calcolaStatisticheCommessa(c, tutteLeOre, fornitori);
            tableData.push([
                c.nomeCommessa,
                `€${stats.valorePreventivo.toFixed(2)}`,
                Utils.formattaOreDecimali(stats.oreLavorateTotali),
                Utils.formattaOreDecimali(stats.oreNonConformita),
                stats.hasIntegrazione ? `+${Utils.formattaOreDecimali(stats.oreIntegrazione)}` : '-',
                `€${stats.costoDipendenti.toFixed(2)}`,
                stats.hasFornitori ? `€${stats.costiFornitori.toFixed(2)}` : '-',
                `€${stats.costoTotale.toFixed(2)}`,
                `${stats.marginePercentuale.toFixed(1)}%`,
                c.stato === 'attiva' ? 'ATTIVA' : 'CONCLUSA'
            ]);
            
            totalePreventivo += stats.valorePreventivo;
            totaleCosto += stats.costoTotale;
            totaleMargine += stats.margineEuro;
        }

        // 🔥 CREA IL PDF
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        // Intestazione
        doc.setFillColor(37, 99, 235);
        doc.rect(0, 0, 297, 30, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(20);
        doc.text('MONITORAGGIO COMMESSE - DATI FILTRATI', 148, 16, { align: 'center' });
        doc.setFontSize(10);
        doc.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, 148, 24, { align: 'center' });
        doc.setTextColor(0, 0, 0);

        // Info filtri
        let filtroInfo = '';
        const filtriAttivi = [];
        if (filtroNome) filtriAttivi.push(`Commessa: "${filtroNome}"`);
        if (filtroStato) filtriAttivi.push(`Stato: ${filtroStato === 'attive' ? 'Attive' : 'Concluse'}`);
        if (filtroAnno) filtriAttivi.push(`Anno: ${filtroAnno}`);
        if (filtroMese) {
            const mesi = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                         'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
            filtriAttivi.push(`Mese: ${mesi[parseInt(filtroMese) - 1]}`);
        }
        if (filtroFatturato) {
            filtriAttivi.push(`Fatturato: ${filtroFatturato === 'fatturato' ? 'Fatturato' : 'Da fatturare'}`);
        }

        if (filtriAttivi.length > 0) {
            doc.setFontSize(9);
            doc.setTextColor(100, 100, 100);
            doc.text(`Filtri: ${filtriAttivi.join(' • ')}`, 14, 38);
        }

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.text(`Record: ${tableData.length} commesse`, 14, 45);

        // Tabella
        doc.autoTable({
            startY: 50,
            head: [['Commessa', 'Preventivo', 'Ore Lav', 'Ore NC', 'Integr.', 'Costo Dip.', 'Costo Forn.', 'Costo Tot.', 'Margine %', 'Stato']],
            body: tableData,
            theme: 'grid',
            styles: { fontSize: 7, cellPadding: 2 },
            headStyles: { fillColor: [37, 99, 235], textColor: 255 },
            columnStyles: {
                0: { cellWidth: 30 },
                1: { cellWidth: 20, halign: 'right' },
                2: { cellWidth: 18, halign: 'center' },
                3: { cellWidth: 18, halign: 'center' },
                4: { cellWidth: 16, halign: 'center' },
                5: { cellWidth: 22, halign: 'right' },
                6: { cellWidth: 22, halign: 'right' },
                7: { cellWidth: 22, halign: 'right' },
                8: { cellWidth: 20, halign: 'right' },
                9: { cellWidth: 18, halign: 'center' }
            }
        });

        // Riepilogo
        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(10);
        doc.text(`📊 Riepilogo (${tableData.length} commesse)`, 14, finalY);
        doc.text(`Totale Preventivi: €${totalePreventivo.toFixed(2)}`, 14, finalY + 6);
        doc.text(`Totale Costi: €${totaleCosto.toFixed(2)}`, 14, finalY + 12);
        doc.text(`Margine Totale: €${totaleMargine.toFixed(2)}`, 14, finalY + 18);
        doc.text(`Margine Medio: ${(totalePreventivo > 0 ? (totaleMargine / totalePreventivo * 100) : 0).toFixed(1)}%`, 14, finalY + 24);

        // Salva
        const nomeFile = `monitoraggio_filtrato_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(nomeFile);
        
        NotificationService.success(`PDF generato con ${tableData.length} commesse filtrate!`);

    } catch (error) {
        console.error('❌ Errore PDF monitoraggio:', error);
        NotificationService.error('Errore durante la generazione PDF: ' + error.message);
    }
}

    async testGenerazionePDF() {
        try {
            if (typeof window.jspdf === 'undefined') {
                await this.caricaLibreriePDF();
            }

            const { jsPDF } = window.jspdf;
            if (!jsPDF) {
                NotificationService.error('jsPDF non disponibile');
                return;
            }

            const doc = new jsPDF();
            doc.text('Test PDF - ' + new Date().toLocaleString(), 20, 20);
            doc.text('Se vedi questo, le librerie PDF funzionano!', 20, 30);
            doc.save('test_pdf.pdf');
            
            NotificationService.success('Test PDF completato con successo!');
        } catch (error) {
            console.error('Errore test PDF:', error);
            NotificationService.error('Errore nel test PDF');
        }
    }

      async caricaLibreriePDF() {
        return new Promise((resolve) => {
            if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = () => {
                setTimeout(() => {
                    const autoScript = document.createElement('script');
                    autoScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js';
                    autoScript.onload = resolve;
                    autoScript.onerror = resolve;
                    document.head.appendChild(autoScript);
                }, 100);
            };
            script.onerror = resolve;
            document.head.appendChild(script);
        });
    }

    refreshTutteLeTabelle() {
        console.log('🔄 Refresh forzato di tutte le tabelle...');
        
        if (this.paginazione.ore) {
            this.paginazione.ore.aggiornaDati(stateManager.datiTotali.oreLavorate || []);
        }
        if (this.paginazione.commesse) {
            this.paginazione.commesse.aggiornaDati(stateManager.datiTotali.commesse || []);
        }
        if (this.paginazione.dipendenti) {
            this.paginazione.dipendenti.aggiornaDati(stateManager.datiTotali.dipendenti || []);
        }
        if (this.paginazione.fornitori) {
            this.paginazione.fornitori.aggiornaDati(stateManager.datiTotali.fornitori || []);
        }
        
        this.aggiornaTabellaOreLavorate(stateManager.datiFiltrati);
        this.aggiornaTabellaCommesse();
        this.aggiornaTabellaDipendenti();
        this.aggiornaTabellaFornitori();
        
        console.log('✅ Refresh completato');
    }

    getChartThemeColors() {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        
        return {
            textColor: isDark ? '#e8edf5' : '#0f172a',
            gridColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
            borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
            background: isDark ? '#1a2234' : '#ffffff'
        };
    }

    diagnosticaPaginazioni() {
        console.log('=== DIAGNOSTICA PAGINAZIONI ===');
        console.log('Stato Manager:', {
            currentUser: stateManager.currentUser?.ruolo || 'nessuno',
            datiTotali: {
                oreLavorate: stateManager.datiTotali.oreLavorate?.length || 0,
                commesse: stateManager.datiTotali.commesse?.length || 0,
                dipendenti: stateManager.datiTotali.dipendenti?.length || 0,
                fornitori: stateManager.datiTotali.fornitori?.length || 0
            }
        });
        
        const paginazioni = ['ore', 'commesse', 'dipendenti', 'fornitori'];
        paginazioni.forEach(nome => {
            const pag = this.paginazione[nome];
            if (pag) {
                const containerEsiste = pag.container !== null && pag.container !== undefined;
                console.log(`📊 ${nome}:`, {
                    container: containerEsiste ? '✅' : '❌',
                    containerId: pag.containerId,
                    totale: pag.datiTotali?.length || 0,
                    pagina: pag.paginaCorrente || 1,
                    perPagina: pag.righePerPagina || 10,
                    visibile: pag.container?.style?.display || 'N/A'
                });
            } else {
                console.log(`❌ ${nome}: NON INIZIALIZZATA`);
            }
        });
        
        console.log('🔍 Container HTML:');
        ['paginationOre', 'paginationCommesse', 'paginationDipendenti', 'paginationFornitori'].forEach(id => {
            const el = document.getElementById(id);
            console.log(`  ${id}: ${el ? '✅' : '❌'}`);
        });
        
        console.log('✅ Diagnostica completata');
    }
}

// ============================================================
// 8. INIZIALIZZAZIONE APP
// ============================================================

let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new OreLavorateApp();
    window.app = app;
    
    window.cambiaOrdineOre = function(criterio) {
        if (app && typeof app.cambiaOrdineOre === 'function') {
            app.cambiaOrdineOre(criterio);
        } else {
            console.error('❌ Metodo cambiaOrdineOre non disponibile');
            if (app) {
                app.aggiornaTabellaOreLavorate();
            }
        }
    };
    
    window.aggiornaTabellaOreLavorate = function() {
        if (app) app.aggiornaTabellaOreLavorate();
    };
    
    console.log('✅ Union14 App v2.0 caricata con successo!');
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    if (!window.app) {
        app = new OreLavorateApp();
        window.app = app;
        window.cambiaOrdineOre = function(criterio) {
            if (app && typeof app.cambiaOrdineOre === 'function') {
                app.cambiaOrdineOre(criterio);
            }
        };
    }
}

const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    .notification-toast {
        animation: slideInRight 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
`;
document.head.appendChild(style);
window.stateManager = stateManager;
console.log('✅ Union14 App v2.0 caricata con successo!');
