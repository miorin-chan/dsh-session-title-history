const en = {
  history: 'Title history', close: 'Close', loading: 'Loading title history…', empty: 'No title history yet.',
  failed: 'Could not load title history.', retry: 'Retry', manual: 'Manual edit', provider: 'Automatically generated',
  fallback: 'Automatically generated · Built-in rule', first: 'First title', unchanged: 'Text unchanged',
  inherited: 'Inherited from parent session', previous: 'Previous title',
}

export type Label = keyof typeof en
export const labels = {
  en,
  zh: {
    history: '标题历史', close: '关闭', loading: '正在读取标题历史…', empty: '暂无标题历史。',
    failed: '无法读取标题历史。', retry: '重试', manual: '手动修改', provider: '自动生成',
    fallback: '自动生成 · 内置规则', first: '首次命名', unchanged: '文字未变', inherited: '继承自父会话', previous: '旧标题',
  },
  ja: {
    history: 'タイトル履歴', close: '閉じる', loading: 'タイトル履歴を読み込み中…', empty: 'タイトル履歴はまだありません。',
    failed: 'タイトル履歴を読み込めませんでした。', retry: '再試行', manual: '手動変更', provider: '自動生成',
    fallback: '自動生成 · 組み込みルール', first: '最初のタイトル', unchanged: 'テキスト変更なし', inherited: '親セッションから継承', previous: '以前のタイトル',
  },
  de: {
    history: 'Titelverlauf', close: 'Schließen', loading: 'Titelverlauf wird geladen…', empty: 'Noch kein Titelverlauf vorhanden.',
    failed: 'Der Titelverlauf konnte nicht geladen werden.', retry: 'Erneut versuchen', manual: 'Manuell geändert', provider: 'Automatisch erstellt',
    fallback: 'Automatisch erstellt · Integrierte Regel', first: 'Erster Titel', unchanged: 'Text unverändert', inherited: 'Aus der übergeordneten Sitzung übernommen', previous: 'Vorheriger Titel',
  },
  es: {
    history: 'Historial de títulos', close: 'Cerrar', loading: 'Cargando el historial de títulos…', empty: 'Aún no hay historial de títulos.',
    failed: 'No se pudo cargar el historial de títulos.', retry: 'Reintentar', manual: 'Edición manual', provider: 'Generado automáticamente',
    fallback: 'Generado automáticamente · Regla integrada', first: 'Primer título', unchanged: 'Texto sin cambios', inherited: 'Heredado de la sesión de origen', previous: 'Título anterior',
  },
  fr: {
    history: 'Historique des titres', close: 'Fermer', loading: 'Chargement de l’historique des titres…', empty: 'Aucun titre dans l’historique.',
    failed: 'Impossible de charger l’historique des titres.', retry: 'Réessayer', manual: 'Modification manuelle', provider: 'Généré automatiquement',
    fallback: 'Généré automatiquement · Règle intégrée', first: 'Premier titre', unchanged: 'Texte inchangé', inherited: 'Hérité de la session parente', previous: 'Titre précédent',
  },
  pt: {
    history: 'Histórico de títulos', close: 'Fechar', loading: 'A carregar o histórico de títulos…', empty: 'Ainda não há histórico de títulos.',
    failed: 'Não foi possível carregar o histórico de títulos.', retry: 'Tentar novamente', manual: 'Edição manual', provider: 'Gerado automaticamente',
    fallback: 'Gerado automaticamente · Regra integrada', first: 'Primeiro título', unchanged: 'Texto inalterado', inherited: 'Herdado da sessão de origem', previous: 'Título anterior',
  },
  ru: {
    history: 'История заголовков', close: 'Закрыть', loading: 'Загрузка истории заголовков…', empty: 'История заголовков пока пуста.',
    failed: 'Не удалось загрузить историю заголовков.', retry: 'Повторить', manual: 'Изменено вручную', provider: 'Создано автоматически',
    fallback: 'Создано автоматически · Встроенное правило', first: 'Первый заголовок', unchanged: 'Текст не изменился', inherited: 'Унаследовано от родительской сессии', previous: 'Предыдущий заголовок',
  },
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-session-title-history': Label
  }
}
