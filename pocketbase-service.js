// ============================================================
// POCKETBASE SERVICE - URL FISSO HTTPS
// ============================================================

class PocketBaseService {
    constructor() {
        // 🔥 URL FISSO PER IL DOMINIO PUBBLICO
        const url = 'https://app-ore-union14.appcomcloud.net';
        
        console.log('🔗 PocketBase URL FISSO:', url);
        
        this.pb = new PocketBase(url);
        this.currentUser = null;
        
        // Disabilita auto-cancellazione
        this.pb.autoCancellation(false);
        
        console.log('✅ PocketBase Service CREATO con URL:', this.pb.baseUrl);
    }

    async login(email, password) {
        try {
            const authData = await this.pb.collection('users').authWithPassword(email, password);
            this.currentUser = authData.record;
            console.log('✅ Login OK:', authData.record.email);
            return authData;
        } catch (error) {
            console.error('❌ Login error:', error);
            throw error;
        }
    }

    logout() {
        this.pb.authStore.clear();
        this.currentUser = null;
        console.log('✅ Logout OK');
    }

    isLoggedIn() {
        return this.pb.authStore.isValid;
    }

    getUser() {
        return this.pb.authStore.model;
    }

    async getCollection(collectionName, filters = '', sort = '-created', limit = 1000) {
        try {
            console.log(`📡 Richiesta: ${collectionName}`);
            const result = await this.pb.collection(collectionName).getList(1, limit, {
                filter: filters,
                sort: sort,
                requestKey: null
            });
            console.log(`✅ ${collectionName}: ${result.items.length} record`);
            return result.items;
        } catch (error) {
            console.error(`❌ Errore ${collectionName}:`, error);
            return [];
        }
    }

    async getCollectionAll(collectionName) {
        try {
            const result = await this.pb.collection(collectionName).getFullList({
                sort: '-created'
            });
            return result;
        } catch (error) {
            console.error(`❌ Errore ${collectionName}:`, error);
            return [];
        }
    }

    async getRecord(collectionName, id) {
        try {
            const record = await this.pb.collection(collectionName).getOne(id);
            return record;
        } catch (error) {
            console.error(`❌ Errore record ${id}:`, error);
            return null;
        }
    }

    async addDocument(collectionName, data) {
        try {
            const record = await this.pb.collection(collectionName).create(data);
            console.log(`✅ Record aggiunto a ${collectionName}:`, record.id);
            return record;
        } catch (error) {
            console.error(`❌ Errore creazione ${collectionName}:`, error);
            throw error;
        }
    }

    async updateDocument(collectionName, id, data) {
        try {
            const record = await this.pb.collection(collectionName).update(id, data);
            console.log(`✅ Record ${id} aggiornato`);
            return record;
        } catch (error) {
            console.error(`❌ Errore aggiornamento ${collectionName}:`, error);
            throw error;
        }
    }

    async deleteDocument(collectionName, id) {
        try {
            await this.pb.collection(collectionName).delete(id);
            console.log(`✅ Record ${id} eliminato`);
        } catch (error) {
            console.error(`❌ Errore eliminazione ${collectionName}:`, error);
            throw error;
        }
    }

    async getOreLavorateFiltrate(filtri = {}) {
        try {
            let filter = '';
            if (filtri.commessa) filter += `commessa~"${filtri.commessa}" && `;
            if (filtri.dipendente) filter += `(nomeDipendente~"${filtri.dipendente}" || cognomeDipendente~"${filtri.dipendente}") && `;
            if (filtri.anno) filter += `data~"${filtri.anno}" && `;
            if (filtri.mese) filter += `data~"-${filtri.mese}-" && `;
            if (filtri.giorno) filter += `data~"-${filtri.giorno}" && `;
            if (filtri.nonConformita) filter += `nonConformita=true && `;
            
            if (filter.endsWith(' && ')) {
                filter = filter.slice(0, -4);
            }
            
            const result = await this.pb.collection('oreLavorate').getList(1, 1000, {
                filter: filter,
                sort: '-data,-created',
                requestKey: null
            });
            return result.items;
        } catch (error) {
            console.error('❌ Errore filtri ore:', error);
            return [];
        }
    }

    async getDipendenti() {
        try {
            const result = await this.pb.collection('dipendenti').getFullList({
                sort: 'cognome,nome'
            });
            return result;
        } catch (error) {
            console.error('❌ Errore dipendenti:', error);
            return [];
        }
    }

    async getCommesse() {
        try {
            const result = await this.pb.collection('commesse').getFullList({
                sort: '-created'
            });
            return result;
        } catch (error) {
            console.error('❌ Errore commesse:', error);
            return [];
        }
    }
}

// 🔥 CREA L'ISTANZA GLOBALE
const pbService = new PocketBaseService();
console.log('✅ pbService disponibile');
console.log('✅ pbService.pb.baseUrl:', pbService.pb.baseUrl);
