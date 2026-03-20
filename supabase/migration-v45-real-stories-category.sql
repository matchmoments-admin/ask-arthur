-- Add "Real Stories" blog category
INSERT INTO blog_categories (name, slug, description, sort_order)
VALUES (
  'Real Stories',
  'real-stories',
  'First-hand accounts of scams caught in the wild — what happened, what Arthur said, and what to do next.',
  5
)
ON CONFLICT (slug) DO NOTHING;
