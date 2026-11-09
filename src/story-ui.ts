import type { StoryRequest, StoryView } from './game/story.ts';

/** NPC dialogue and journal share native DOM controls; only conversations transact. */
export function createStoryUI(root: HTMLElement, labels: Map<string, HTMLElement>, options: AddEventListenerOptions,
  open: () => void, close: () => void) {
  const get = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const dialog = get<HTMLDialogElement>('story-dialog');
  let view: StoryView = null, speaker: string | undefined, receipt = '', busy = false, selected: string | undefined;
  let onTalk = (_id: string) => {}, onAction: (request: StoryRequest) => Promise<void> = async () => {};
  let onEnd = () => {};
  let marker: HTMLButtonElement | undefined;
  const text = (id: string, value: string) => { const e = get(id); if (e.textContent !== value) e.textContent = value; };
  function syncMarkers() {
    const npc = view?.npc, label = npc && labels.get(npc.id);
    if (!view || !label || view.status === 'claimed') { marker?.remove(); marker = undefined; return; }
    if (marker?.parentElement !== label) {
      marker?.remove(); marker = document.createElement('button'); marker.type = 'button';
      marker.className = 'story-npc-marker'; marker.dataset.questNpc = npc!.id;
      marker.addEventListener('click', event => { event.stopPropagation(); onTalk(npc!.id); }, options);
      label.append(marker);
    }
    marker!.textContent = view.marker; marker!.dataset.status = view.status;
    marker!.setAttribute('aria-label', `与${npc!.name}交谈：${view.statusName}`);
    marker!.title = `${npc!.name} · ${view.statusName}`;
  }
  function render() {
    get('story-open').hidden = !view;
    get('story-talk-selected').hidden = !view?.npc || selected !== view.npc.id;
    syncMarkers();
    if (!view) { if (dialog.open) close(); return; }
    const talking = speaker === view.npc?.id && speaker !== undefined;
    dialog.dataset.mode = talking ? 'conversation' : 'journal';
    dialog.dataset.stage = view.stage; dialog.dataset.status = view.status;
    text('story-current', `${view.statusName} · ${view.title}`);
    text('story-heading', talking ? `与${view.npc!.name}交谈` : '任务日志 · 第一章');
    text('story-title', receipt ? '奖励已交接' : view.title); text('story-status', receipt ? '已领奖' : view.statusName);
    text('story-speaker', talking ? view.npc!.name : '');
    text('story-text', talking ? view.dialogue : view.text);
    text('story-objective', view.objective); text('story-rewards', view.rewards);
    get<HTMLProgressElement>('story-progress').value = view.progress;
    get('story-dialogue').classList.toggle('npc-dialogue-bubble', talking);
    get('story-speaker').hidden = !talking;
    get('story-focus').hidden = !view.target || !!receipt;
    get('story-find-npc').hidden = !view.npc || talking || !!receipt;
    text('story-find-npc', view.npc ? `找到${view.npc.name} · 交谈${view.status === 'reward' ? '领奖' : ''}` : '暂无可交谈的居民');
    get('story-journal').hidden = talking;
    const journal = get('story-journal'), key = JSON.stringify(view.journal);
    if (journal.dataset.entries !== key) {
      journal.dataset.entries = key;
      journal.replaceChildren(...view.journal.map(row => {
        const li = document.createElement('li'), title = document.createElement('strong'), status = document.createElement('span');
        title.textContent = row.title; status.textContent = row.status; li.append(title, status); return li;
      }));
    }
    get('story-details').hidden = !!receipt;
    get('story-receipt').hidden = !receipt; text('story-receipt-text', receipt);
    get('story-receipt-next').hidden = !receipt || view.status === 'claimed';
    text('story-close', receipt || view.status === 'claimed' ? '返回家园' : talking && view.status === 'available' ? '稍后再说' : '结束交谈');
    if (!talking) text('story-close', '返回家园');
    for (const id of ['accept', 'report', 'claim', 'invite', 'tools', 'supplies'] as const) {
      const button = get<HTMLButtonElement>(`story-${id}`), action = view.actions.find(a => a.id === id);
      button.hidden = !talking || !action || !!receipt; button.disabled = busy || !!action?.disabled;
      if (action) button.textContent = action.label;
    }
  }
  get('story-open').addEventListener('click', () => { speaker = undefined; receipt = ''; text('story-feedback', ''); render(); open(); get('story-scroll').scrollTop = 0; }, options);
  get('story-close').addEventListener('click', close, options);
  dialog.addEventListener('close', () => { if (speaker) onEnd(); }, options);
  for (const id of ['story-focus', 'story-find-npc']) get(id).addEventListener('click', close, options);
  get('story-talk-selected').addEventListener('click', () => { if (selected) onTalk(selected); }, options);
  get('story-receipt-next').addEventListener('click', () => { receipt = ''; text('story-feedback', ''); render(); get('story-scroll').scrollTop = 0; }, options);
  get('story-actions').addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-story-action]');
    if (!view || !speaker || speaker !== view.npc?.id || !button || button.disabled || busy) return;
    const action = view.actions.find(a => a.id === button.dataset.storyAction);
    if (!action || action.disabled) return;
    const request = { action: action.id, stage: view.stage, npc: speaker };
    busy = true; render();
    try { await onAction(request); }
    catch { text('story-feedback', '交接暂未完成，请稍后重试'); }
    finally { busy = false; render(); }
  }, options);
  return {
    syncStoryMarkers: syncMarkers,
    setStory(value: StoryView) { view = value; render(); },
    setStoryResident(id?: string) { selected = id; get('story-talk-selected').hidden = !view?.npc || selected !== view.npc.id; },
    bindStoryTalk(callback: typeof onTalk) { onTalk = callback; },
    bindStoryClose(callback: typeof onEnd) { onEnd = callback; },
    bindStoryAction(callback: typeof onAction) { onAction = callback; },
    openStoryDialogue(id: string) {
      if (!view?.npc || view.npc.id !== id) return;
      speaker = id; receipt = ''; text('story-feedback', ''); render(); open(); get('story-scroll').scrollTop = 0;
    },
    closeStoryDialogue: close,
    storyFeedback(message: string) { text('story-feedback', message); },
    showStoryReceipt(message: string) { receipt = message; text('story-feedback', ''); render(); get('story-scroll').scrollTop = 0; },
  };
}
