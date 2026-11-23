const en = {
  history: 'Title history', close: 'Close', loading: 'Loading title history…', empty: 'No title history yet.',
  failed: 'Could not load title history.', retry: 'Retry', manual: 'Manual edit', provider: 'Automatically generated',
  fallback: 'Built-in title', first: 'First title', unchanged: 'Text unchanged',
  inherited: 'Inherited from parent session',
  showUnchanged: 'Show unchanged writes ({count})', hideUnchanged: 'Hide unchanged writes',
}

export type Label = keyof typeof en
export const labels = {
  en,
  zh: {
    history: '标题历史', close: '关闭', loading: '正在读取标题历史…', empty: '暂无标题历史。',
    failed: '无法读取标题历史。', retry: '重试', manual: '手动修改', provider: '自动生成',
    fallback: '内置规则生成', first: '首次命名', unchanged: '文字未变', inherited: '继承自父会话',
    showUnchanged: '展开同名写入（{count} 条）', hideUnchanged: '折叠同名写入',
  },
  ja: {
    history: 'タイトル履歴', close: '閉じる', loading: 'タイトル履歴を読み込み中…', empty: 'タイトル履歴はまだありません。',
    failed: 'タイトル履歴を読み込めませんでした。', retry: '再試行', manual: '手動変更', provider: '自動生成',
    fallback: '組み込みルールで生成', first: '最初のタイトル', unchanged: 'テキスト変更なし', inherited: '親セッションから継承',
    showUnchanged: '同じタイトルの記録を表示（{count} 件）', hideUnchanged: '同じタイトルの記録を折りたたむ',
  },
  de: {
    history: 'Titelverlauf', close: 'Schließen', loading: 'Titelverlauf wird geladen…', empty: 'Noch kein Titelverlauf vorhanden.',
    failed: 'Der Titelverlauf konnte nicht geladen werden.', retry: 'Erneut versuchen', manual: 'Manuell geändert', provider: 'Automatisch erstellt',
    fallback: 'Durch integrierte Regel erstellt', first: 'Erster Titel', unchanged: 'Text unverändert', inherited: 'Aus der übergeordneten Sitzung übernommen',
    showUnchanged: 'Unveränderte Einträge anzeigen ({count})', hideUnchanged: 'Unveränderte Einträge ausblenden',
  },
  es: {
    history: 'Historial de títulos', close: 'Cerrar', loading: 'Cargando el historial de títulos…', empty: 'Aún no hay historial de títulos.',
    failed: 'No se pudo cargar el historial de títulos.', retry: 'Reintentar', manual: 'Edición manual', provider: 'Generado automáticamente',
    fallback: 'Generado por regla integrada', first: 'Primer título', unchanged: 'Texto sin cambios', inherited: 'Heredado de la sesión de origen',
    showUnchanged: 'Mostrar registros sin cambios ({count})', hideUnchanged: 'Ocultar registros sin cambios',
  },
  fr: {
    history: 'Historique des titres', close: 'Fermer', loading: 'Chargement de l’historique des titres…', empty: 'Aucun titre dans l’historique.',
    failed: 'Impossible de charger l’historique des titres.', retry: 'Réessayer', manual: 'Modification manuelle', provider: 'Généré automatiquement',
    fallback: 'Généré par une règle intégrée', first: 'Premier titre', unchanged: 'Texte inchangé', inherited: 'Hérité de la session parente',
    showUnchanged: 'Afficher les entrées inchangées ({count})', hideUnchanged: 'Masquer les entrées inchangées',
  },
  pt: {
    history: 'Histórico de títulos', close: 'Fechar', loading: 'A carregar o histórico de títulos…', empty: 'Ainda não há histórico de títulos.',
    failed: 'Não foi possível carregar o histórico de títulos.', retry: 'Tentar novamente', manual: 'Edição manual', provider: 'Gerado automaticamente',
    fallback: 'Gerado por regra integrada', first: 'Primeiro título', unchanged: 'Texto inalterado', inherited: 'Herdado da sessão de origem',
    showUnchanged: 'Mostrar registos inalterados ({count})', hideUnchanged: 'Ocultar registos inalterados',
  },
  ru: {
    history: 'История заголовков', close: 'Закрыть', loading: 'Загрузка истории заголовков…', empty: 'История заголовков пока пуста.',
    failed: 'Не удалось загрузить историю заголовков.', retry: 'Повторить', manual: 'Изменено вручную', provider: 'Создано автоматически',
    fallback: 'Создано встроенным правилом', first: 'Первый заголовок', unchanged: 'Текст не изменился', inherited: 'Унаследовано от родительской сессии',
    showUnchanged: 'Показать записи без изменений ({count})', hideUnchanged: 'Скрыть записи без изменений',
  },
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-session-title-history': Label
  }
}
