import { english } from './translations.js';
import { traditional } from './traditional.js';
import { japanese, korean } from './east-asian.js';
import { nexusCopy } from './nexus-copy.js';
import { nexusTraditional } from './nexus-traditional.js';
import { meowCopy } from './meow-copy.js';
import { meowTraditional } from './meow-traditional.js';
import { polyverseCopy } from './polyverse-copy.js';
import { polyverseTraditional } from './polyverse-traditional.js';
import { dynamicCopy } from './dynamic-copy.js';
import { dynamicTraditional } from './dynamic-traditional.js';
import { adminCopy } from './admin-copy.js';
import { adminTraditional } from './admin-traditional.js';
import { workflowCopy } from './workflow-copy.js';
import { workflowTraditional } from './workflow-traditional.js';
import { legacyCopy } from './legacy-copy.js';
import { legacyTraditional } from './legacy-traditional.js';
import { panoramaCopy } from './panorama-copy.js';

export const LOCALE_KEY = 'strgo:locale:v1';
export const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
const dictionaries = { 'zh-TW': traditional, en: english, ja: japanese, ko: korean };
const dynamicDictionaries = { ...dynamicCopy, 'zh-TW': dynamicTraditional };
const adminDictionaries = { ...adminCopy, 'zh-TW': adminTraditional };
const workflowDictionaries = { ...workflowCopy, 'zh-TW': workflowTraditional };
const legacyDictionaries = { ...legacyCopy, 'zh-TW': legacyTraditional };
const isLegacyPage = () => /^\/(?:archive|updates|terminal)(?:\/|$)/.test(globalThis.location?.pathname || '') || /^\/projects\//.test(globalThis.location?.pathname || '');
const isArchivePage = () => /^\/archive(?:\/|$)/.test(globalThis.location?.pathname || '');
const isWorkflowPage = () => globalThis.document?.documentElement?.dataset.strgoSurface === 'workflow';
const isSiteAdminPage = () => /^\/admin\/?$/.test(globalThis.location?.pathname || '');
const isAiAdminPage = () => /^\/admin\/ai\/?$/.test(globalThis.location?.pathname || '');
const nexusDictionaries = { ...nexusCopy, 'zh-TW': nexusTraditional };
const isNexusPage = () => /^\/nexus(?:\/|$)/.test(globalThis.location?.pathname || '');
const isMeowPage = () => /^\/meow(?:\/|$)/.test(globalThis.location?.pathname || '');
const isPolyversePage = () => /^\/polyverse(?:\/|$)/.test(globalThis.location?.pathname || '');
const polyverseDictionaries = { ...polyverseCopy, 'zh-TW': polyverseTraditional };
const meowDictionaries = { ...meowCopy, 'zh-TW': meowTraditional };
let current;

export function resolveLocale(saved, languages = []) {
  if (SUPPORTED_LOCALES.includes(saved)) return saved;
  const preferred = Array.isArray(languages) ? languages : [languages];
  const language = preferred.find(value => typeof value === 'string' && value.trim());
  if (!language) return 'zh-CN';
  if (/^zh(?:-|$)/i.test(language)) return /^zh-(?:Hant|TW|HK|MO)(?:-|$)/i.test(language) ? 'zh-TW' : 'zh-CN';
  if (/^ja(?:-|$)/i.test(language)) return 'ja';
  if (/^ko(?:-|$)/i.test(language)) return 'ko';
  return 'en';
}

export function getLocale() {
  if (current) return current;
  let saved;
  try { saved = globalThis.localStorage?.getItem(LOCALE_KEY); } catch { /* Storage may be blocked. */ }
  const languages = globalThis.navigator?.languages?.length ? globalThis.navigator.languages : [globalThis.navigator?.language];
  return current = resolveLocale(saved, languages);
}

export function setLocale(locale, { persist = true } = {}) {
  if (!SUPPORTED_LOCALES.includes(locale)) return false;
  current = locale;
  if (persist) { try { globalThis.localStorage?.setItem(LOCALE_KEY, locale); } catch { /* Keep this tab usable. */ } }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('strgo:localechange', { detail: { locale } }));
  return true;
}

export function translate(source, locale = getLocale()) {
  if (typeof source !== 'string' || (locale === 'zh-CN' && !isMeowPage() && !isPolyversePage() && !isWorkflowPage())) return source;
  const match = source.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const text = match[2];
  const dictionary = dictionaries[locale] || {};
  let value = panoramaCopy[locale]?.[text] ?? (isWorkflowPage() ? workflowDictionaries[locale]?.[text] : undefined) ?? (isLegacyPage() ? legacyDictionaries[locale]?.[text] : undefined) ?? (isPolyversePage() ? polyverseDictionaries[locale]?.[text] : undefined) ?? (isMeowPage() ? meowDictionaries[locale]?.[text] : undefined) ?? (isNexusPage() ? nexusDictionaries[locale]?.[text] : undefined) ?? ((isSiteAdminPage() || isAiAdminPage()) ? adminDictionaries[locale]?.[text] : undefined) ?? dynamicDictionaries[locale]?.[text] ?? dictionary[text] ?? (locale === 'zh-TW' || locale === 'zh-CN' ? undefined : english[text]);
  // MEOW also has English source labels composed at runtime (for example,
  // gallery titles followed by an arrow), so let its patterns run in zh-CN.
  if (value === undefined && locale === 'zh-CN' && !isPolyversePage() && !isMeowPage()) return source;
  if (value === undefined) {
    let m;
    if (isPolyversePage() && (m = text.match(/^(\d+) RESULTS(?: FOR “([\s\S]*)”)?$/))) {
      const suffix=m[2] ? { 'zh-CN':` · “${m[2]}”`, 'zh-TW':` · “${m[2]}”`, ja:` · 「${m[2]}」`, ko:` · “${m[2]}”` }[locale] || ` FOR “${m[2]}”` : '';
      value=({ 'zh-CN':`${m[1]} 条结果`, 'zh-TW':`${m[1]} 條結果`, ja:`${m[1]} 件`, ko:`결과 ${m[1]}개` }[locale] || `${m[1]} RESULTS`) + suffix;
    } else if (isPolyversePage() && (m = text.match(/^(\d\d \/ )(.+)$/)) && polyverseDictionaries[locale]?.[m[2]]) {
      value=m[1]+translate(m[2],locale);
    } else if (isPolyversePage() && (m = text.match(/^([XYZWVU]{2}) rotation · radians$/))) {
      value = { 'zh-CN':`${m[1]} 旋转 · 弧度`, 'zh-TW':`${m[1]} 旋轉 · 弧度`, ja:`${m[1]} 回転 · ラジアン`, ko:`${m[1]} 회전 · 라디안` }[locale];
    } else if (isPolyversePage() && (m = text.match(/^Advanced planes \((\d+)\)$/))) {
      value = { 'zh-CN':`更多旋转平面（${m[1]}）`, 'zh-TW':`更多旋轉平面（${m[1]}）`, ja:`詳細な回転平面（${m[1]}）`, ko:`고급 회전 평면 (${m[1]})` }[locale];
    } else if (isPolyversePage() && (m = text.match(/^(.+) ↗$/)) && polyverseDictionaries[locale]?.[m[1]]) {
      value=translate(m[1],locale)+' ↗';
    } else if (isPolyversePage() && (m = text.match(/^(params\.[A-Za-z][A-Za-z0-9]*): (unknown parameter|unknown option|expected boolean|expected true or false)\.$/))) {
      const index=['unknown parameter','unknown option','expected boolean','expected true or false'].indexOf(m[2]); const labels={ 'zh-CN':['未知参数','未知选项','需要布尔值','需要 true 或 false'], 'zh-TW':['未知參數','未知選項','需要布林值','需要 true 或 false'], ja:['不明なパラメータ','不明な選択肢','真偽値が必要です','true または false が必要です'], ko:['알 수 없는 매개변수','알 수 없는 옵션','불리언 값이 필요합니다','true 또는 false가 필요합니다'] };if(labels[locale])value=`${m[1]}: ${labels[locale][index]}.`;
    } else if (isPolyversePage() && (m = text.match(/^(params\.[A-Za-z][A-Za-z0-9]*): use a number from (-?[\d.]+) to (-?[\d.]+)\.$/))) {
      value={ 'zh-CN':`${m[1]}：请输入 ${m[2]} 至 ${m[3]} 的数值。`, 'zh-TW':`${m[1]}：請輸入 ${m[2]} 至 ${m[3]} 的數值。`, ja:`${m[1]}：${m[2]} から ${m[3]} の数値を入力してください。`, ko:`${m[1]}: ${m[2]}에서 ${m[3]} 사이의 값을 입력하세요.` }[locale];
    } else if (isPolyversePage() && (m = text.match(/^Import rejected · (.+)$/))) {
      const prefix={ 'zh-CN':'导入被拒绝', 'zh-TW':'匯入被拒絕', ja:'読み込みを拒否', ko:'가져오기 거부' }[locale]; if(prefix)value=`${prefix} · ${translate(m[1],locale)}`;
    } else if (isPolyversePage() && (m = text.match(/^Rendering quality: (auto|low|medium|high)$/))) {
      const prefix={ 'zh-CN':'渲染质量', 'zh-TW':'渲染質量', ja:'描画品質', ko:'렌더링 화질' }[locale]; if(prefix)value=`${prefix}: ${translate(m[1],locale)}`;
    } else if (isPolyversePage() && (m = text.match(/^(.+) — POLYVERSE$/)) && polyverseDictionaries[locale]?.[m[1]]) {
      value=translate(m[1],locale)+' — POLYVERSE';
    } else if (isMeowPage() && (m = text.match(/^(\d+) (位朋友|件作品|条可搜索内容 · 输入关键词开始)$/))) {
      const n=m[1],unit=m[2]; value = unit==='位朋友' ? {en:`${n} friends`,'zh-TW':`${n} 位朋友`,ja:`${n} 匹の友だち`,ko:`친구 ${n}마리`}[locale] : unit==='件作品' ? {en:`${n} works`,'zh-TW':`${n} 件作品`,ja:`${n} 作品`,ko:`작품 ${n}개`}[locale] : {en:`${n} searchable items · enter a keyword`,'zh-TW':`${n} 條可搜尋內容 · 輸入關鍵詞開始`,ja:`検索対象 ${n} 件 · キーワードを入力`,ko:`검색 가능한 항목 ${n}개 · 검색어 입력`}[locale];
    } else if (isMeowPage() && (m = text.match(/^(.+) · 播放中(（单次预览）)?$/)) && meowDictionaries[locale]?.[m[1]]) {
      const action=translate(m[1],locale), single=!!m[2]; value={en:`${action} · Playing${single?' (single preview)':''}`,'zh-TW':`${action} · 播放中${single?'（單次預覽）':''}`,ja:`${action} · 再生中${single?'（1 回プレビュー）':''}`,ko:`${action} · 재생 중${single?' (1회 미리보기)':''}`}[locale];
    } else if (isMeowPage() && (m = text.match(/^idle · (已回到暂停状态|轻轻呼吸中)$/))) {
      value=`${{en:'Idle','zh-CN':'待机','zh-TW':'待機',ja:'待機',ko:'대기'}[locale]} · ${translate(m[1],locale)}`;
    } else if (isMeowPage() && (m = text.match(/^(当前网址|导入未完成|无法生成图片)：(.+)$/))) {
      const labels={en:['Current URL','Import incomplete','Image creation failed'],'zh-TW':['當前網址','匯入未完成','無法生成圖片'],ja:['現在の URL','読み込み未完了','画像を作成できません'],ko:['현재 주소','가져오기 미완료','이미지를 만들 수 없습니다']}; const index=['当前网址','导入未完成','无法生成图片'].indexOf(m[1]); if(labels[locale])value=`${labels[locale][index]}: ${index===0?m[2]:translate(m[2],locale)}`;
    } else if (isMeowPage() && (m = text.match(/^认识 ([A-Za-z]+)$/))) {
      value={en:`Meet ${m[1]}`,'zh-TW':`認識 ${m[1]}`,ja:`${m[1]} に会う`,ko:`${m[1]} 만나기`}[locale];
    } else if (isMeowPage() && (m = text.match(/^(.+) ([←→])$/)) && meowDictionaries[locale]?.[m[1]]) {
      value=`${translate(m[1],locale)} ${m[2]}`;
    } else if (isMeowPage() && (m = text.match(/^([A-Za-z]+) · (.+)$/)) && meowDictionaries[locale]?.[m[2]]) {
      value=`${m[1]} · ${translate(m[2],locale)}`;
    } else if (isMeowPage() && (m = text.match(/^([A-Za-z]+)：(.+)，(.+)$/))) {
      value=`${m[1]}: ${translate(m[2],locale)}, ${m[3].split('、').map(part=>translate(part,locale)).join(', ')}`;
    } else if (isMeowPage() && (m = text.match(/^(取消收藏|收藏) (.+)$/))) {
      const action = m[1]==='收藏'?{en:'Favorite','zh-CN':'收藏','zh-TW':'收藏',ja:'お気に入りに追加',ko:'즐겨찾기 추가'}[locale]:{en:'Remove favorite','zh-CN':'取消收藏','zh-TW':'取消收藏',ja:'お気に入りから削除',ko:'즐겨찾기 제거'}[locale]; value = `${action} ${translate(m[2],locale)}`;
    } else if (isMeowPage() && (m = text.match(/^(.+。) (每件商品都有自己的三维结构，可以旋转观察正面、侧面与背面。)$/))) {
      value=`${translate(m[1],locale)} ${translate(m[2],locale)}`;
    } else if (isMeowPage() && (m = text.match(/^· (短毛|长毛|半长毛|近乎无毛)$/))) {
      value=`· ${translate(m[1],locale)}`;
    } else if (isNexusPage() && (m = text.match(/^(\d+) 个本地结果( \/ 全部内容)?$/))) {
      const all = !!m[2]; value = { en: `${m[1]} local results${all ? ' / all content' : ''}`, 'zh-TW': `${m[1]} 個本地結果${all ? ' / 全部內容' : ''}`, ja: `ローカル結果 ${m[1]} 件${all ? ' / すべて' : ''}`, ko: `로컬 결과 ${m[1]}개${all ? ' / 전체 콘텐츠' : ''}` }[locale];
    } else if (isNexusPage() && (m = text.match(/^NEXUS \/ (.+)$/)) && nexusDictionaries[locale]?.[m[1]]) {
      value=`NEXUS / ${translate(m[1],locale)}`;
    } else if (isNexusPage() && (m = text.match(/^(.*?) \/ (NEXUS ARCHIVE|[\d.]+ (?:B )?(?:LY|KM)|查看目的地 ↗)$/))) {
      value = `${translate(m[1], locale)} / ${translate(m[2], locale)}`;
    } else if (isNexusPage() && (m = text.match(/^✓ 演示航线已生成：地球 → 深空跃迁点 → (.+)$/))) {
      const destination = translate(m[1], locale); value = { en: `✓ Demo route created: Earth → Deep-space jump point → ${destination}`, 'zh-TW': `✓ 演示航線已生成：地球 → 深空躍遷點 → ${destination}`, ja: `✓ デモ航路を作成：地球 → 深宇宙ジャンプ地点 → ${destination}`, ko: `✓ 데모 항로 생성: 지구 → 심우주 도약 지점 → ${destination}` }[locale];
    } else if (isNexusPage() && (m = text.match(/^画质已设为：(.+)$/))) {
      value = { en: `Quality set to: ${m[1]}`, 'zh-TW': `畫質已設為：${m[1]}`, ja: `画質を設定：${m[1]}`, ko: `화질 설정: ${m[1]}` }[locale];
    } else if (isNexusPage() && (m = text.match(/^(\d+ \/ )(.+?) — (.+)$/))) {
      value = `${m[1]}${translate(m[2], locale)} — ${translate(m[3], locale)}`;
    } else if (isArchivePage() && (m = text.match(/^(星际巡航飞船|重装钢铁机甲|赛博探索机器人) \/ (已锁定|点击锁定)$/))) {
      value=`${translate(m[1],locale)} / ${translate(m[2],locale)}`;
    } else if (isArchivePage() && (m = text.match(/^已锁定(星际巡航飞船|重装钢铁机甲|赛博探索机器人) (.+)。$/))) {
      const type=translate(m[1],locale);value={en:`Locked ${type} ${m[2]}.`,'zh-TW':`已鎖定${type} ${m[2]}。`,ja:`${type} ${m[2]} を固定しました。`,ko:`${type} ${m[2]}을(를) 고정했습니다.`}[locale];
    } else if (isArchivePage() && (m = text.match(/^已高亮(星际巡航飞船|重装钢铁机甲|赛博探索机器人|全部银河舰队)。所有单位继续环绕银河。$/))) {
      const type=translate(m[1],locale);value={en:`Highlighted ${type}. All units continue orbiting the galaxy.`,'zh-TW':`已高亮${type}。所有單位繼續環繞銀河。`,ja:`${type} を強調しました。すべての機体は銀河を周回し続けます。`,ko:`${type}을(를) 강조했습니다. 모든 유닛은 계속 은하를 공전합니다.`}[locale];
    } else if (isArchivePage() && (m = text.match(/^可以手动复制：(.+)$/))) {
      value={en:`Copy manually: ${m[1]}`,'zh-TW':`可以手動複製：${m[1]}`,ja:`手動でコピー：${m[1]}`,ko:`직접 복사: ${m[1]}`}[locale];
    } else if (isLegacyPage() && (m = text.match(/^联系 (.+) ↗$/))) {
      value={en:`Contact ${m[1]} ↗`,'zh-TW':`聯繫 ${m[1]} ↗`,ja:`${m[1]} に連絡 ↗`,ko:`${m[1]}에게 연락 ↗`}[locale];
    } else if (isAiAdminPage() && (m = text.match(/^实际费用（([A-Z]{3})）$/))) {
      value={en:`Actual cost (${m[1]})`,'zh-TW':`實際費用（${m[1]}）`,ja:`実際の費用（${m[1]}）`,ko:`실제 비용 (${m[1]})`}[locale];
    } else if (isAiAdminPage() && (m = text.match(/^(对话|—) \/ (音乐|—)$/))) {
      value=`${translate(m[1],locale)} / ${translate(m[2],locale)}`;
    } else if (isAiAdminPage() && (m = text.match(/^(\d+) 次 \/ (\d+) 秒$/))) {
      value={en:`${m[1]} chats / ${m[2]} seconds`,'zh-TW':`${m[1]} 次 / ${m[2]} 秒`,ja:`${m[1]} 回 / ${m[2]} 秒`,ko:`${m[1]}회 / ${m[2]}초`}[locale];
    } else if (isAiAdminPage() && /^(?:AI 对话|音乐生成)(?: \/ (?:AI 对话|音乐生成))?$/.test(text)) {
      value=text.split(' / ').map(part=>translate(part,locale)).join(' / ');
    } else if (isAiAdminPage() && (m = text.match(/^(GPU 任务占用中|已连接|待连接检查)( · 排空中)?$/))) {
      value=translate(m[1],locale)+(m[2]?` · ${translate('排空中',locale)}`:'');
    } else if (isAiAdminPage() && (m = text.match(/^(\d+) 个连接$/))) {
      value={en:`${m[1]} connections`,'zh-TW':`${m[1]} 個連接`,ja:`${m[1]} 件の接続`,ko:`연결 ${m[1]}개`}[locale];
    } else if (isSiteAdminPage() && (m = text.match(/^共 (\d+) 条( · .+)?$/))) {
      value={en:`${m[1]} total${m[2] || ''}`,'zh-TW':`共 ${m[1]} 條${m[2] || ''}`,ja:`合計 ${m[1]} 件${m[2] || ''}`,ko:`총 ${m[1]}건${m[2] || ''}`}[locale];
    } else if (isSiteAdminPage() && (m = text.match(/^(\d+) 张 \/ (\d+) 首$/))) {
      value={en:`${m[1]} images / ${m[2]} tracks`,'zh-TW':`${m[1]} 張 / ${m[2]} 首`,ja:`画像 ${m[1]} 件 / 音声 ${m[2]} 件`,ko:`이미지 ${m[1]}개 / 오디오 ${m[2]}개`}[locale];
    } else if (isSiteAdminPage() && (m = text.match(/^有效期至 (.+)$/))) {
      value={en:`Valid until ${m[1]}`,'zh-TW':`有效期至 ${m[1]}`,ja:`有効期限 ${m[1]}`,ko:`유효 기간 ${m[1]}`}[locale];
    } else if (isSiteAdminPage() && (m = text.match(/^(.+) (\d+)$/)) && adminDictionaries[locale]?.[m[1]]) {
      value=`${translate(m[1],locale)} ${m[2]}`;
    } else if ((globalThis.location?.pathname || '').startsWith('/forum/') && (m = text.match(/^(\d+) (分钟|小时)前$/))) {
      const n=m[1],hours=m[2]==='小时';value={en:`${n} ${hours?'hours':'minutes'} ago`,'zh-TW':`${n} ${hours?'小時':'分鐘'}前`,ja:`${n} ${hours?'時間':'分'}前`,ko:`${n}${hours?'시간':'분'} 전`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/forum/') && (m = text.match(/^(已编辑|已读|未读) · (.+)$/))) {
      value=`${translate(m[1],locale)} · ${translate(m[2],locale)}`;
    } else if ((globalThis.location?.pathname || '').startsWith('/forum/') && (m = text.match(/^(\d+) 条评论 · 阅读话题$/))) {
      value={en:`${m[1]} comments · Read topic`,'zh-TW':`${m[1]} 條評論 · 閱讀話題`,ja:`${m[1]} 件のコメント · 話題を読む`,ko:`댓글 ${m[1]}개 · 주제 읽기`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/forum/') && (m = text.match(/^(\d+) 篇话题$/))) {
      value={en:`${m[1]} topics`,'zh-TW':`${m[1]} 篇話題`,ja:`${m[1]} 件の話題`,ko:`주제 ${m[1]}개`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/forum/') && (m = text.match(/^评论 · (\d+)$/))) {
      value={en:`Comments · ${m[1]}`,'zh-TW':`評論 · ${m[1]}`,ja:`コメント · ${m[1]}`,ko:`댓글 · ${m[1]}`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/image-playground/') && (m = text.match(/^最近备份 (.+)$/))) {
      const prefix={en:'Last backup: ','zh-TW':'最近備份 ',ja:'前回のバックアップ：',ko:'최근 백업: '}[locale];if(prefix)value=prefix+m[1];
    } else if ((globalThis.location?.pathname || '').startsWith('/image-playground/') && (m = text.match(/^生成后自动保存至(.+)$/))) {
      const prefix={en:'Automatically saved to ','zh-TW':'生成後自動保存至',ja:'生成後の保存先：',ko:'생성 후 자동 저장 위치: '}[locale];if(prefix)value=prefix+m[1];
    } else if ((globalThis.location?.pathname || '').startsWith('/image-playground/') && (m = text.match(/^一键套用预装灵感（(\d+) 个）$/))) {
      value={en:`Apply built-in inspiration (${m[1]})`,'zh-TW':`一鍵套用預裝靈感（${m[1]} 個）`,ja:`プリセットのアイデアを適用（${m[1]} 件）`,ko:`기본 영감 적용 (${m[1]}개)`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^✧ 本次占用 (\d+) 秒额度$/))) {
      value={en:`✧ Uses ${m[1]} seconds of allowance`,'zh-TW':`✧ 本次佔用 ${m[1]} 秒額度`,ja:`✧ 今回は ${m[1]} 秒の利用枠を使用`,ko:`✧ 이번 작업에 ${m[1]}초 한도 사용`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (text === '秒' || text === '次')) {
      const seconds=text==='秒';value={en:seconds?'sec':'requests','zh-TW':text,ja:seconds?'秒':'回',ko:seconds?'초':'회'}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^(\d+) 秒$/))) {
      value={en:`${m[1]} seconds`,'zh-TW':`${m[1]} 秒`,ja:`${m[1]} 秒`,ko:`${m[1]}초`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^费用上限 ([A-Z]{3}) ([\d.]+)$/))) {
      const prefix={en:'Cost cap','zh-TW':'費用上限',ja:'費用上限',ko:'비용 상한'}[locale];if(prefix)value=`${prefix} ${m[1]} ${m[2]}`;
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^([\s\S]+) · (本地|在线 API)( · 不可用)?$/))) {
      const local=m[2]==='本地', labels={en:[local?'Local':'Online API','Unavailable'],'zh-TW':[local?'本地':'線上 API','不可用'],ja:[local?'ローカル':'オンライン API','利用不可'],ko:[local?'로컬':'온라인 API','사용 불가']};if(labels[locale])value=`${m[1]} · ${labels[locale][0]}${m[3]?` · ${labels[locale][1]}`:''}`;
    } else if (((globalThis.location?.pathname || '').startsWith('/ai/') || isAiAdminPage()) && (m = text.match(/^今日剩余 (\d+) (秒|次)$/))) {
      const seconds=m[2]==='秒';value={en:`${m[1]} ${seconds?'seconds':'requests'} left today`,'zh-TW':`今日剩餘 ${m[1]} ${m[2]}`,ja:`本日の残り ${m[1]} ${seconds?'秒':'回'}`,ko:`오늘 ${m[1]}${seconds?'초':'회'} 남음`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^(删除对话|删除|播放) (.+)$/))) {
      const labels={en:['Delete conversation','Delete','Play'],'zh-TW':['刪除對話','刪除','播放'],ja:['会話を削除','削除','再生'],ko:['대화 삭제','삭제','재생']};const index=['删除对话','删除','播放'].indexOf(m[1]);if(labels[locale])value=`${labels[locale][index]} ${m[2]}`;
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^有效期：(.+)$/))) {
      const prefix={en:'Valid until: ','zh-TW':'有效期：',ja:'有効期限：',ko:'유효 기간: '}[locale]; if(prefix)value=prefix+translate(m[1],locale);
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^已使用 (\d+) · 任务预占 (\d+)$/))) {
      value={en:`Used ${m[1]} · Reserved ${m[2]}`,'zh-TW':`已使用 ${m[1]} · 任務預佔 ${m[2]}`,ja:`使用済み ${m[1]} · タスク予約 ${m[2]}`,ko:`사용 ${m[1]} · 작업 예약 ${m[2]}`}[locale];
    } else if ((globalThis.location?.pathname || '').startsWith('/ai/') && (m = text.match(/^(\d+) \/ (\d+) (次|秒)$/))) {
      const unit=m[3]==='次'?{en:'requests','zh-TW':'次',ja:'回',ko:'회'}[locale]:{en:'seconds','zh-TW':'秒',ja:'秒',ko:'초'}[locale];if(unit)value=`${m[1]} / ${m[2]} ${unit}`;
    } else if ((m = text.match(/^(\d+) 个主入口 \/ (\d+) 个沉浸空间 \/ 一个起点$/))) {
      value = { en: `${m[1]} features / ${m[2]} immersive spaces / one starting point`, 'zh-TW': `${m[1]} 個主入口 / ${m[2]} 個沉浸空間 / 一個起點`, ja: `${m[1]} の機能 / ${m[2]} つの空間 / ひとつの入口`, ko: `기능 ${m[1]}개 / 몰입형 공간 ${m[2]}개 / 하나의 시작점` }[locale];
    } else if ((m = text.match(/^(\d+) 个匹配入口$/))) {
      value = { en: `${m[1]} matching ${m[1] === '1' ? 'feature' : 'features'}`, 'zh-TW': `${m[1]} 個符合的入口`, ja: `${m[1]} 件の機能`, ko: `일치하는 기능 ${m[1]}개` }[locale];
    } else if ((m = text.match(/^本机访问记录 · (.+)$/))) {
      value = { en: 'Recent on this device', 'zh-TW': '本機訪問記錄', ja: 'このデバイスの最近の履歴', ko: '이 기기의 최근 기록' }[locale] + ' · ' + translate(m[1], locale);
    } else if ((m = text.match(/^梦境 (\d\d) ↗$/))) {
      value = { en: `Dream ${m[1]} ↗`, 'zh-TW': `夢境 ${m[1]} ↗`, ja: `夢 ${m[1]} ↗`, ko: `꿈 ${m[1]} ↗` }[locale];
    } else if ((m = text.match(/^(取消收藏|收藏)(.+)$/)) && (english[m[2]] || dictionary[m[2]])) {
      value = translate(m[1], locale) + translate(m[2], locale);
    } else if ((m = text.match(/^(.+)视觉示意$/)) && (english[m[1]] || dictionary[m[1]])) {
      value = translate(m[1], locale) + { en: ' illustration', 'zh-TW': '視覺示意', ja: 'のイメージ', ko: ' 이미지' }[locale];
    } else if ((m = text.match(/^(.+) · STRGO$/))) {
      const part = translate(m[1], locale); if (part !== m[1]) value = `${part} · STRGO`;
    } else if ((m = text.match(/^STRGO · (.+)$/))) {
      const part = translate(m[1], locale); if (part !== m[1]) value = `STRGO · ${part}`;
    }
  }
  return value !== undefined ? match[1] + value + match[3] : source;
}

// A whitelist of UI regions, not a translation service. Never traverse user content.
const protectedContent = [
  '[data-strgo-user-content]', 'option:not([value])', 'script', 'style', 'code', 'pre', '[contenteditable]:not([contenteditable="false"])',
  '#profile', '#dialog-description', '.local-message p', '#selection-info',
  '#posts', '#comments-list', '#notifications-list', '#detail-content', '#delete-description:not([data-strgo-static])', '#header-name', '#side-name', '#side-avatar', '#header-avatar',
  '#account-name', '#conversation-list', '#auth-error', '.account-avatar', '.account', '#music-results', '#current-output', '#library-list', '#preset-results', '#preset-list', '#shared-preset-list', '#inspiration-list', '#reference-name', '#preview-prompt', '#model-label:not([data-strgo-static])', '#storage-description:not([data-strgo-static])', '.assistant-column',
  '#music-form select[name="model_id"]', '[data-toast-text]', '.message-content', '.post-preview', '.post-author', '.author-name'
].join(',');
const records = new WeakMap();
let initialized = false;

function isHubPage() {
  return document.documentElement.dataset.strgoUi === 'hub' || (/^\/ai\/(?:tasks|assets)\/?$/.test(location.pathname) && !!document.querySelector('#railNav'));
}

function localizesTitle() { return isHubPage() || isWorkflowPage() || isLegacyPage() || isNexusPage() || isMeowPage() || isPolyversePage() || isSiteAdminPage() || isAiAdminPage() || /^\/ai(?:\/|$)/.test(location.pathname) || /^\/(?:home|dance|forum|image-playground)\/?$/.test(location.pathname); }

function eligible(element) {
  if (!element || element.closest('[data-strgo-user-content], [contenteditable]:not([contenteditable="false"]), .post-preview, .comment-body, .author-name')) return false;
  if (isWorkflowPage() && element.closest('#jobs') && !element.closest('#jobs [data-strgo-ui-copy]')) return false;
  if (isAiAdminPage() && element.closest('#admin-content .error, #dialog-content .error')) return false;
  const forumCopy = (globalThis.location?.pathname || '').startsWith('/forum/') && element.closest('[data-strgo-ui-copy]') && element.closest('#posts, #comments-list, #notifications-list, #detail-content');
  const imageCopy = (globalThis.location?.pathname || '').startsWith('/image-playground/') && element.closest('[data-strgo-ui-copy]') && element.closest('#current-output, #library-list, #inspiration-list');
  const aiCopy = ((globalThis.location?.pathname || '').startsWith('/ai/') || isAiAdminPage()) && element.closest('[data-strgo-ui-copy]') && element.closest('#main, #dialog-content, .sidebar .account');
  const staticToast = !!element.closest('#toast[data-strgo-static]');
  if ((element.closest(protectedContent) && !forumCopy && !imageCopy && !aiCopy) || (!isNexusPage() && !isPolyversePage() && !staticToast && element.closest('#dialog-title, #toast'))) return false;
  const html = document.documentElement;
  const surface = html.dataset.strgoUi;
  const path = location.pathname;
  if (element.tagName === 'TITLE' && localizesTitle()) return true;
  if (isWorkflowPage()) return !!element.closest('header, #auth, #studio, footer');
  if (isHubPage() || surface === 'classic') return true;
  if (surface === 'experience') return isArchivePage() || isNexusPage() || isMeowPage() || isPolyversePage() || /^\/(?:home|dance|360)\/?$/.test(path);
  if (path.startsWith('/forum/')) return staticToast || !!element.closest('.skip, .topbar, #auth-view, #workspace, .mobile-bottom, dialog');
  if (path.startsWith('/image-playground/')) return staticToast || !!element.closest('.skip, .topbar, #auth-view, #workspace, #image-dialog');
  if (path.startsWith('/ai/')) return staticToast || aiCopy || !!element.closest('.skip, #app .initial-loading, .service-banner, .sidebar nav, .back-home, .topbar, .workspace-footer, #main .page-heading, #main .overview-heading, #main .overview-cards, #main .recent-panel > .panel-title, #main .quota-card, #main .history, #main .music-composer > .panel-title, #main .music-results > .panel-title, #music-form, .settings-grid, .settings-panel, #access-form') || (!!document.querySelector('#login-form, #access-form') && !!element.closest('#dialog-content'));
  if (isSiteAdminPage()) return !!element.closest('.skip, .layout aside, .workspace > header, .workspace > footer, #main, #feedback[data-strgo-static]');
  if (isAiAdminPage()) return staticToast || aiCopy || !!element.closest('.skip, #app .initial-loading, .sidebar nav, .back-home, .topbar, .workspace-footer, #main .page-heading, #main .admin-tabs, #main > section > .empty, #main > section > button, #admin-content .panel-title, #admin-content thead, #admin-content .info-note, #admin-content .empty, #admin-content [data-strgo-ui-copy], #admin-content > section > h2, #admin-content .admin-lower > section > h2, #admin-content .reconcile-panel > p, #admin-content .table-wrap + p, #admin-content button, #model-editor, #node-form, #budget-form, #member-form, #dialog-content, #dialog > .dialog-x');
  if (path.startsWith('/admin/')) return staticToast || !!element.closest('.layout aside, .workspace > header, .workspace > footer');
  return false;
}

function updateValue(node, attribute) {
  const element = attribute ? node : node.parentElement;
  if (!eligible(element)) return;
  const value = attribute ? node.getAttribute(attribute) : node.nodeValue;
  if (value == null) return;
  let record = records.get(node);
  if (!record) { record = {}; records.set(node, record); }
  const key = attribute || '#text';
  let entry = record[key];
  // An application may update a status after we localize it; treat that as fresh UI copy.
  if (!entry || (value !== entry.source && value !== entry.rendered)) entry = { source: value, rendered: value };
  const next = translate(entry.source);
  entry.rendered = next; record[key] = entry;
  if (value !== next) {
    if (attribute) node.setAttribute(attribute, next); else node.nodeValue = next;
  }
}

export function localizeTree(node) {
  if (!node) return;
  if (node.nodeType === 3) { updateValue(node); return; }
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
  if (node.nodeType === 1) {
    if (node.matches('[data-strgo-user-content], [contenteditable]:not([contenteditable="false"]), .post-preview, .comment-body, .author-name')) return;
    if (node.matches(protectedContent)) {
      if ((globalThis.location?.pathname || '').startsWith('/forum/') && node.matches('#posts, #comments-list, #notifications-list, #detail-content, .post-author')) for (const copy of node.querySelectorAll('[data-strgo-ui-copy]')) localizeTree(copy);
      if ((globalThis.location?.pathname || '').startsWith('/image-playground/') && node.matches('#current-output, #library-list, #inspiration-list')) for (const copy of node.querySelectorAll('[data-strgo-ui-copy]')) localizeTree(copy);
      if ((globalThis.location?.pathname || '').startsWith('/ai/') && node.matches('#music-results, #conversation-list, #music-form select[name="model_id"]')) for (const copy of node.querySelectorAll('[data-strgo-ui-copy]')) localizeTree(copy);
      if (((globalThis.location?.pathname || '').startsWith('/ai/') || isAiAdminPage()) && node.matches('.sidebar .account')) for (const copy of node.querySelectorAll('[data-strgo-ui-copy]')) localizeTree(copy);
      return;
    }
    for (const attribute of ['aria-label', 'placeholder', 'alt', 'title']) if (node.hasAttribute(attribute)) updateValue(node, attribute);
    if (node.matches('input, textarea, option:not([value])')) return; // Never change form values.
  }
  for (const child of node.childNodes) localizeTree(child);
}

export function setupI18n() {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  window.strgoI18n = Object.freeze({ translate, getLocale, setLocale, supportedLocales: SUPPORTED_LOCALES });
  const start = () => {
    const update = () => {
      const surface = document.documentElement.dataset.strgoUi;
      if (isHubPage() || isWorkflowPage() || isLegacyPage() || isSiteAdminPage() || isAiAdminPage() || surface === 'classic' || (surface === 'experience' && (isNexusPage() || isMeowPage() || isPolyversePage() || /^\/(?:home|dance|360)\/?$/.test(location.pathname))) || /^\/(?:forum|image-playground|ai)\//.test(location.pathname)) document.documentElement.lang = getLocale();
      localizeTree(document.body);
      if (localizesTitle()) localizeTree(document.querySelector('title'));
    };
    update();
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') localizeTree(mutation.target);
        else if (mutation.type === 'attributes') updateValue(mutation.target, mutation.attributeName);
        else for (const node of mutation.addedNodes) localizeTree(node);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder', 'alt', 'title'] });
    const title = document.querySelector('title');
    if (localizesTitle() && title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    window.addEventListener('strgo:localechange', update);
    window.addEventListener('strgo:localerequest', event => setLocale(event.detail?.locale));
    window.addEventListener('storage', event => {
      if (event.key === LOCALE_KEY) setLocale(resolveLocale(event.newValue, navigator.languages), { persist: false });
    });
    window.dispatchEvent(new CustomEvent('strgo:i18nready'));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
}
