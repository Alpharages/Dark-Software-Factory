/** A single comment on a PM-tool task, normalized across providers. */
export class NormalizedComment {
  id!: string;
  text!: string;
  /** Provider user id of the comment author — compared against the bot's own id
   * to tell a human reply apart from something DSF itself posted. */
  authorId!: string;
  authorName!: string;
  createdAt!: Date;
}
