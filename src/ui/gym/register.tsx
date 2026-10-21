/**
 * The gym area's contributions to the shell: side-pane kinds (gym reader G7, revision list
 * G8, To-dos page G4), the topic picker (G1/G2/G3), the gym source opener (S6), and its
 * top-bar buttons. Imported once by the app shell.
 */
import { Dumbbell, History, ListTodo } from 'lucide-react';
import type { GymLocator } from '../../core/model/types';
import { registerPane } from '../panes/registry';
import { registerSourceOpener, registerTopicPicker } from '../common/registries';
import { GymPane, gymTabTitle } from './GymReader';
import { RevisionPane } from './RevisionPane';
import { TodosPane } from './TodosPane';
import { GymTopicPicker } from './TopicPicker';
import { openGym, openPane, requestReveal } from './open';
import { installGymTestHooks } from './testHooks';
import './gym.css';

registerPane('gym', { component: GymPane, title: gymTabTitle });
registerPane('revision', { component: RevisionPane, title: () => 'Revision' });
registerPane('todos', { component: TodosPane, title: () => 'To-dos' });
registerTopicPicker(GymTopicPicker);

// S6: a clip from a gym file opens the file in the side pane, scrolled to the quote, flashed
registerSourceOpener('gym', (link) => {
  const loc = link.locator.type === 'gym' ? (link.locator as GymLocator) : null;
  const path = loc?.path || link.id;
  if (loc) requestReveal(path, loc);
  openGym(path);
});

installGymTestHooks();

/** Top-bar buttons: To-dos, Revision, Gym. */
export function GymTopbarButtons() {
  return (
    <>
      <button className="icon-btn" aria-label="To-dos" title="To-dos" onClick={() => openPane({ kind: 'todos' })}>
        <ListTodo size={18} />
      </button>
      <button className="icon-btn" aria-label="Revision list" title="Revision list" onClick={() => openPane({ kind: 'revision' })}>
        <History size={18} />
      </button>
      <button className="icon-btn" aria-label="Gym" title="Gym" onClick={() => openGym('')}>
        <Dumbbell size={18} />
      </button>
    </>
  );
}
