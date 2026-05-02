import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Building, Palette, Database, Download, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import styles from './InvoiceCreator.module.css';

export function Settings() {
  const [companyName, setCompanyName] = useState('MrChartist');
  const [companyEmail, setCompanyEmail] = useState('billing@mrchartist.com');
  const [companyAddress, setCompanyAddress] = useState('123 Dalal Street\nMumbai, MH 400001\nIndia');
  const [companyGstin, setCompanyGstin] = useState('');
  const [companyWebsite, setCompanyWebsite] = useState('www.mrchartist.com');
  const [defaultCurrency, setDefaultCurrency] = useState('INR');
  const [defaultTaxRate, setDefaultTaxRate] = useState(18);
  const [invoicePrefix, setInvoicePrefix] = useState('INV');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('mrchartist_inv_settings');
    if (stored) {
      try {
        const s = JSON.parse(stored);
        setCompanyName(s.companyName || 'MrChartist');
        setCompanyEmail(s.companyEmail || '');
        setCompanyAddress(s.companyAddress || '');
        setCompanyGstin(s.companyGstin || '');
        setCompanyWebsite(s.companyWebsite || '');
        setDefaultCurrency(s.defaultCurrency || 'INR');
        setDefaultTaxRate(s.defaultTaxRate ?? 18);
        setInvoicePrefix(s.invoicePrefix || 'INV');
      } catch {}
    }
  }, []);

  const handleSave = () => {
    const settings = { companyName, companyEmail, companyAddress, companyGstin, companyWebsite, defaultCurrency, defaultTaxRate, invoicePrefix };
    localStorage.setItem('mrchartist_inv_settings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExportData = () => {
    const data: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('mrchartist_inv_')) {
        data[key] = localStorage.getItem(key);
      }
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
          Object.entries(data).forEach(([key, value]) => {
            localStorage.setItem(key, value as string);
          });
          alert('Data restored successfully! Refreshing...');
          window.location.reload();
        } catch {
          alert('Invalid backup file.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <SettingsIcon size={24} /> Settings
        </h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Company Profile Card */}
        <div className={styles.card}>
          <div className={styles.cardHeader} style={{ borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Building size={16} /> Company Profile
          </div>
          <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Company Name</label>
              <input className={styles.input} value={companyName} onChange={e => setCompanyName(e.target.value)} />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Email</label>
              <input className={styles.input} value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Address</label>
              <textarea className={styles.input} rows={3} value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} style={{ resize: 'none' }} />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.label}>GSTIN</label>
              <input className={styles.input} value={companyGstin} onChange={e => setCompanyGstin(e.target.value)} placeholder="Optional" />
            </div>
            <div className={styles.inputGroup}>
              <label className={styles.label}>Website</label>
              <input className={styles.input} value={companyWebsite} onChange={e => setCompanyWebsite(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Preferences Card */}
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

          {/* Data Management Card */}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
