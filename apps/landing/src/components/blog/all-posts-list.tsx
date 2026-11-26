import { formatDate, type Post } from "@/lib/blog/posts";

type Group = { topic: string; posts: Post[] };

function byTopic(posts: readonly Post[]): Group[] {
  const groups = new Map<string, Post[]>();
  for (const post of posts) {
    const topic = post.tags[0]!;
    groups.set(topic, [...(groups.get(topic) ?? []), post]);
  }
  return [...groups].map(([topic, list]) => ({ topic, posts: list }));
}

function anchor(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export function AllPostsList({ posts }: { posts: readonly Post[] }) {
  const groups = byTopic(posts);
  return (
    <div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-muted">
        {groups.map((group) => (
          <a key={group.topic} href={`#${anchor(group.topic)}`} className="hover:text-accent">
            {group.topic} ({group.posts.length})
          </a>
        ))}
      </p>
      {groups.map((group) => (
        <section key={group.topic} id={anchor(group.topic)} className="mt-12 scroll-mt-28">
          <h2 className="display text-[30px] leading-none">{group.topic}</h2>
          <ul className="mt-5 divide-y divide-line border-y border-line">
            {group.posts.map((post) => (
              <li key={post.slug} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
                <time dateTime={post.date} className="shrink-0 text-[14px] text-muted tabular-nums sm:w-32">
                  {formatDate(post.date)}
                </time>
                <a href={`/blog/${post.slug}`} className="text-[17px] leading-[25px] font-medium text-text hover:text-accent">
                  {post.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
