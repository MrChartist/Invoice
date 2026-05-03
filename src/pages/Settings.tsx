import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Building, Palette, Database, Download, Upload, Plus, Trash2, CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { generateId } from '../lib/localDb';
import styles from './InvoiceCreator.module.css';
import { type SenderProfile } from '../store/useInvoiceStore';

export function Settings() {
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('');
  const [editingProfileId, setEditingProfileId] = useState<string>('');
  
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [defaultTaxRate, setDefaultTaxRate] = useState(0);
  const [invoicePrefix, setInvoicePrefix] = useState('INV');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('mrchartist_inv_settings');
    if (stored) {
      try {
        const s = JSON.parse(stored);
        
        // Migration from old flat settings to new profiles array
        if (!s.profiles) {
          const defaultProfile: SenderProfile = {
            id: generateId(),
            companyName: s.companyName || 'Rohit Singh',
            companyEmail: s.companyEmail || 'mrchartist@zohomail.in',
            companyAddress: s.companyAddress || '73 Sagouni Post Chouka Teh Kesli\nSagar, Madhya Pradesh 470235',
            companyPhone: s.companyPhone || '7581838868',
            companyTagline: s.companyTagline || 'Financial Consultant',
            companyGstin: s.companyGstin || '',
            companyWebsite: s.companyWebsite || '',
            bankName: 'ICICI Bank (Savings)',
            accountName: 'ROHIT SINGH',
            accountNumber: '081801505319',
            ifsc: 'ICIC0000949',
            upiId: '8726696911@icici'
          };
          setProfiles([defaultProfile]);
          setActiveProfileId(defaultProfile.id!);
          setEditingProfileId(defaultProfile.id!);
        } else {
          setProfiles(s.profiles);
          setActiveProfileId(s.activeProfileId);
          setEditingProfileId(s.profiles.length > 0 ? s.profiles[0].id : '');
        }

        setDefaultCurrency(s.defaultCurrency || 'INR');
        setDefaultTaxRate(s.defaultTaxRate ?? 0);
        setInvoicePrefix(s.invoicePrefix || 'INV');
      } catch {}
    } else {
      // Setup initial default
      const pId = generateId();
      setProfiles([{
        id: pId,
        companyName: 'Rohit Singh',
        companyEmail: 'mrchartist@zohomail.in',
        companyAddress: '73 Sagouni Post Chouka Teh Kesli\nSagar, Madhya Pradesh 470235',
        companyPhone: '7581838868',
        companyTagline: 'Financial Consultant',
        companyGstin: '',
        companyWebsite: '',
        bankName: 'ICICI Bank (Savings)',
        accountName: 'ROHIT SINGH',
        accountNumber: '081801505319',
        ifsc: 'ICIC0000949',
        upiId: '8726696911@icici'
      }]);
      setActiveProfileId(pId);
      setEditingProfileId(pId);
    }
  }, []);

  const handleSave = () => {
    const settings = { profiles, activeProfileId, defaultCurrency, defaultTaxRate, invoicePrefix };
    localStorage.setItem('mrchartist_inv_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddProfile = () => {
    const newProfile: SenderProfile = {
      id: generateId(),
      companyName: 'New Entity',
      companyEmail: '',
      companyAddress: '',
      companyPhone: '',
      companyTagline: '',
      companyGstin: '',
      companyWebsite: '',
      bankName: '',
      accountName: '',
      accountNumber: '',
      ifsc: '',
      upiId: ''
    };
    setProfiles([...profiles, newProfile]);
    setEditingProfileId(newProfile.id!);
  };

  const handleDeleteProfile = (id: string) => {
    if (profiles.length <= 1) {
      alert("You must have at least one profile.");
      return;
    }
    const updated = profiles.filter(p => p.id !== id);
    setProfiles(updated);
    if (activeProfileId === id) setActiveProfileId(updated[0].id!);
    if (editingProfileId === id) setEditingProfileId(updated[0].id!);
  };

  const updateEditingProfile = (field: keyof SenderProfile, value: string) => {
    setProfiles(profiles.map(p => p.id === editingProfileId ? { ...p, [field]: value } : p));
  };

  const editingProfile = profiles.find(p => p.id === editingProfileId) || profiles[0];

  // (Export/Import logic remains same)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'logo' | 'signature') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
      alert("Image is too large. Please upload an image under 500KB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        updateEditingProfile(field, ev.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleExportData = () => {
    const data: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mrchartist_inv_')) data[key] = localStorage.getItem(key);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mrchartist-invoice-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportData = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          Object.entries(data).forEach(([key, value]) => localStorage.setItem(key, value as string));
          alert('Data restored successfully! Refreshing...');
          window.location.reload();
        } catch { alert('Invalid backup file.'); }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleSaveToDisk = async () => { /* ... skipped for brevity if not changing, but we should include it */
    try {
      const data: Record<string, any> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('mrchartist_inv_')) data[key] = localStorage.getItem(key);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      if ('showSaveFilePicker' in window) {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `mrchartist-invoice-backup-${new Date().toISOString().split('T')[0]}.json`,
          types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else { alert('File System Access API not supported.'); }
    } catch (e: any) { if (e.name !== 'AbortError') alert('Failed to save: ' + e.message); }
  };

  const handleLoadFromDisk = async () => {
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }],
        });
        const file = await handle.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        Object.entries(data).forEach(([key, value]) => localStorage.setItem(key, value as string));
        alert('Data restored from disk! Refreshing...');
        window.location.reload();
      } else { alert('File System Access API not supported.'); }
    } catch (e: any) { if (e.name !== 'AbortError') alert('Failed to load: ' + e.message); }
  };

  if (!editingProfile) return null;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <SettingsIcon size={24} /> Settings
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        
        {/* Left Column: Profiles Management */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className={styles.card}>
            <div className={styles.cardHeader} style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building size={16} /> Sender Profiles
              </div>
              <button onClick={handleAddProfile} className={styles.btnGhost} style={{ padding: '0.25rem', color: 'var(--primary)' }}>
                <Plus size={16} />
              </button>
            </div>
            
            <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem', overflowX: 'auto' }}>
              {profiles.map(p => (
                <div 
                  key={p.id} 
                  onClick={() => setEditingProfileId(p.id!)}
                  style={{ 
                    padding: '0.5rem 1rem', 
                    borderRadius: '8px',
                    border: `1px solid ${editingProfileId === p.id ? 'var(--primary)' : 'var(--border)'}`,
                    backgroundColor: editingProfileId === p.id ? 'var(--primary-light)' : 'transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem'
                  }}
                >
                  {p.companyName || 'Unnamed'} 
                  {activeProfileId === p.id && <CheckCircle size={12} color="var(--primary)" />}
                </div>
              ))}
            </div>

            <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>Editing: {editingProfile.companyName}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {activeProfileId !== editingProfile.id && (
                    <button className={styles.btnGhost} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} onClick={() => setActiveProfileId(editingProfile.id!)}>
                      Set as Default
                    </button>
                  )}
                  <button className={styles.btnGhost} style={{ color: 'var(--destructive)', padding: '0.25rem' }} onClick={() => handleDeleteProfile(editingProfile.id!)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>Company / Sender Name</label>
                <input className={styles.input} value={editingProfile.companyName} onChange={e => updateEditingProfile('companyName', e.target.value)} />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Tagline</label>
                <input className={styles.input} value={editingProfile.companyTagline} onChange={e => updateEditingProfile('companyTagline', e.target.value)} />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Email</label>
                <input className={styles.input} value={editingProfile.companyEmail} onChange={e => updateEditingProfile('companyEmail', e.target.value)} />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Phone / Mobile</label>
                <input className={styles.input} value={editingProfile.companyPhone} onChange={e => updateEditingProfile('companyPhone', e.target.value)} />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Address</label>
                <textarea className={styles.input} rows={3} value={editingProfile.companyAddress} onChange={e => updateEditingProfile('companyAddress', e.target.value)} style={{ resize: 'none' }} />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>GSTIN</label>
                  <input className={styles.input} value={editingProfile.companyGstin || ''} onChange={e => updateEditingProfile('companyGstin', e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>PAN</label>
                  <input className={styles.input} value={editingProfile.pan || ''} onChange={e => updateEditingProfile('pan', e.target.value)} />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem', backgroundColor: 'var(--background-alt)', borderRadius: '8px', border: '1px dashed var(--border)' }}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Company Logo (Max 500KB)</label>
                  <input type="file" accept="image/png, image/jpeg" onChange={(e) => handleImageUpload(e, 'logo')} style={{ fontSize: '0.8125rem' }} />
                  {editingProfile.logo && (
                    <div style={{ marginTop: '0.5rem', position: 'relative', width: 'fit-content' }}>
                      <img src={editingProfile.logo} alt="Logo" style={{ height: '40px', objectFit: 'contain' }} />
                      <button onClick={() => updateEditingProfile('logo', '')} className={styles.btnGhost} style={{ position: 'absolute', top: '-10px', right: '-10px', padding: '0.2rem', background: 'var(--card)', borderRadius: '50%', color: 'var(--destructive)' }} title="Remove Logo"><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Signature (Max 500KB)</label>
                  <input type="file" accept="image/png, image/jpeg" onChange={(e) => handleImageUpload(e, 'signature')} style={{ fontSize: '0.8125rem' }} />
                  {editingProfile.signature && (
                    <div style={{ marginTop: '0.5rem', position: 'relative', width: 'fit-content' }}>
                      <img src={editingProfile.signature} alt="Signature" style={{ height: '40px', objectFit: 'contain' }} />
                      <button onClick={() => updateEditingProfile('signature', '')} className={styles.btnGhost} style={{ position: 'absolute', top: '-10px', right: '-10px', padding: '0.2rem', background: 'var(--card)', borderRadius: '50%', color: 'var(--destructive)' }} title="Remove Signature"><Trash2 size={12} /></button>
                    </div>
                  )}
                </div>
              </div>
              
              <div style={{ padding: '1rem', backgroundColor: 'var(--background-alt)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>Bank Details (for this profile)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Bank Name</label>
                    <input className={styles.input} value={editingProfile.bankName} onChange={e => updateEditingProfile('bankName', e.target.value)} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>Account Name</label>
                    <input className={styles.input} value={editingProfile.accountName} onChange={e => updateEditingProfile('accountName', e.target.value)} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>A/C No</label>
                    <input className={styles.input} value={editingProfile.accountNumber} onChange={e => updateEditingProfile('accountNumber', e.target.value)} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label className={styles.label}>IFSC</label>
                    <input className={styles.input} value={editingProfile.ifsc} onChange={e => updateEditingProfile('ifsc', e.target.value)} />
                  </div>
                  <div className={styles.inputGroup} style={{ gridColumn: '1 / -1' }}>
                    <label className={styles.label}>UPI ID</label>
                    <input className={styles.input} value={editingProfile.upiId} onChange={e => updateEditingProfile('upiId', e.target.value)} />
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Right Column: Preferences & Data */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className={styles.card}>
            <div className={styles.cardHeader} style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Palette size={16} /> Defaults & Preferences
            </div>
            <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Default Currency</label>
                <select className={styles.input} value={defaultCurrency} onChange={e => setDefaultCurrency(e.target.value)} style={{ cursor: 'pointer' }}>
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Default Tax Rate (%)</label>
                <input className={styles.input} type="number" value={defaultTaxRate} onChange={e => setDefaultTaxRate(Number(e.target.value))} />
              </div>
              <div className={styles.inputGroup}>
                <label className={styles.label}>Invoice Number Prefix</label>
                <input className={styles.input} value={invoicePrefix} onChange={e => setInvoicePrefix(e.target.value)} />
              </div>
              <button className={cn(styles.btn, styles.btnPrimary)} onClick={handleSave} style={{ width: '100%', padding: '0.875rem' }}>
                <Save size={16} /> {saved ? '✓ Saved!' : 'Save Settings'}
              </button>
            </div>
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader} style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Database size={16} /> Data Management
            </div>
            <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <p style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
                All data is stored locally in your browser. Use these tools to backup and restore your invoices, clients, and settings.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <button className={cn(styles.btn, styles.btnGhost)} style={{ border: '1px solid var(--border)', padding: '0.875rem' }} onClick={handleExportData}>
                  <Download size={16} /> Export Backup
                </button>
                <button className={cn(styles.btn, styles.btnGhost)} style={{ border: '1px solid var(--border)', padding: '0.875rem' }} onClick={handleImportData}>
                  <Upload size={16} /> Import Backup
                </button>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--primary)', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>
                  💾 Direct Disk Sync (Chrome)
                </p>
                <p style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
                  Link a local folder on your computer. Data is saved directly to disk — no risk of losing data when clearing browser cache.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <button className={cn(styles.btn, styles.btnGhost)} style={{ border: '1px solid var(--primary)', padding: '0.875rem', color: 'var(--primary)' }} onClick={handleSaveToDisk}>
                    <Download size={16} /> Save to Disk
                  </button>
                  <button className={cn(styles.btn, styles.btnGhost)} style={{ border: '1px solid var(--border)', padding: '0.875rem' }} onClick={handleLoadFromDisk}>
                    <Upload size={16} /> Load from Disk
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
