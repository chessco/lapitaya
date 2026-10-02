import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, getLocaleSettings, setAgentLocale, setNotificationLocale } from '@/i18n';
import { ACTIVE_LOCALES } from '@shared/lapitaya/locales';

/**
 * La Pitaya: agentLocale + notificationLocale pickers, shown under the UI
 * language picker in Settings → General. Each is stored on its own and never
 * follows the UI language (see @shared/lapitaya/locales.ts).
 */
export function LocaleSettingsRows({ selectStyle }: { selectStyle: CSSProperties }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(getLocaleSettings);
  const labelOf = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

  const rows = [
    {
      key: 'agentLocale' as const,
      title: t('lapitaya:locales.agentLocale'),
      desc: t('lapitaya:locales.agentLocaleDesc'),
      save: setAgentLocale
    },
    {
      key: 'notificationLocale' as const,
      title: t('lapitaya:locales.notificationLocale'),
      desc: t('lapitaya:locales.notificationLocaleDesc'),
      save: setNotificationLocale
    }
  ];

  return (
    <>
      {rows.map((r) => (
        <div key={r.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>{r.title}</span>
            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{r.desc}</span>
          </div>
          <select
            value={settings[r.key]}
            onChange={(e) => {
              r.save(e.target.value);
              setSettings(getLocaleSettings());
            }}
            style={selectStyle}
            aria-label={r.title}
          >
            {ACTIVE_LOCALES.map((code) => (
              <option key={code} value={code}>{labelOf(code)}</option>
            ))}
          </select>
        </div>
      ))}
    </>
  );
}
