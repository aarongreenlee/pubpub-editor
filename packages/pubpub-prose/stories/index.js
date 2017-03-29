import { SingleMention, SingleReference, TableMarkdown } from './sampledocs';

import FullEditor from './storybookFullEditor';
import MarkdownEditor from './storybookMarkdownEditor';
import React from 'react';
import RichEditor from './storybookRichEditor';
import { storiesOf } from '@kadira/storybook';

storiesOf('Rich Editor', module)
.add('basic ', () => (
	<RichEditor />
))
.add('single reference', () => (
	<RichEditor initialState={SingleReference} />
))
.add('single mention', () => (
	<RichEditor initialState={SingleMention} />
));


storiesOf('Markdown Editor', module)
.add('basic ', () => (
	<MarkdownEditor />
));

storiesOf('Full Editor', module)
.add('basic ', () => (
	<FullEditor />
))
.add('table conversion ', () => (
	<FullEditor mode={'markdown'} initialContent={TableMarkdown} />
))
.add('reference serializing ', () => (
	<FullEditor mode={'rich'} initialContent={SingleReference} />
))
;
