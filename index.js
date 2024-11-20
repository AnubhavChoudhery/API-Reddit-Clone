const express = require('express'); 
const bodyParser = require('body-parser'); 
const cors = require('cors'); 
const { Pool } = require('pg'); 
const bcrypt = require('bcryptjs'); 
const json = require('jsonwebtoken'); 

const app = express(); 
const port = 9000; 

app.use(cors()); 
app.use(bodyParser.json()); 

const pg = new Pool({
  user: 'superuser', 
  host: 'localhost',  
  database: 'pick a name', 
  password: 'your password goes here', 
  port: 5432, //can pick any other port too
});

app.get('/subreddits', async (req, res) => {
  try {
    const sub = await pg.query('SELECT * FROM subreddits ORDER BY created_at DESC');
    console.log("Subreddits fetched successfully");
    res.json(sub.rows); // Successful GET endpoint response
  } catch (e) {
    console.log(e); 
    res.status(500).send('Server error'); 
  }
});

app.post('/subreddits', async (req, res) => {
  const subId = req.body.subreddit_id;
  const name = req.body.name;
  try {
    const sub = await pg.query('INSERT INTO subreddits (subreddit_id, name) VALUES ($1, $2) RETURNING *', [subId, name]);
    console.log('New sub created: ', name);
    res.status(201).json(sub.rows[0]);
  } catch (e) {
    console.log('Error creating sub: ', e);
    res.status(500).send('Server error');
  }
});

app.put('/subreddits/:id', async (req, res) => {
  const subId = req.params.id; 
  const name = req.body.name; 
  try {
    const sub = await pg.query('UPDATE subreddits SET name = $1 WHERE subreddit_id = $2 RETURNING *',[name, subId]);   
    if (sub.rowCount === 0) {
      return res.status(404).send('Subreddit not found');
    }  
    console.log('Sub updated: ', name);
    res.status(200).json(sub.rows[0]);
  } catch (e) {
    console.log('Error updating sub: ', e);
    res.status(500).send('Server error');
  }
});

app.delete('/subreddits', async (req, res) => {
  const subId = req.body.id;
  const name = req.body.name;
  try {
    const sub = await pg.query('DELETE FROM subreddits WHERE subreddit_id = $1 AND name = $2', [subId, name]);
    console.log('Sub deleted: ', name);
    res.status(201).send('Sub deleted: ', name);
  } catch (e) {
    console.log('Error deleting sub: ', e);
    res.status(500).send('Server error');
  }
})

app.get('/subreddits/:id/posts', async (req, res) => {
  const subId = req.params.id; 
  try {
    const posts = await pg.query('SELECT *, karma FROM Posts WHERE subreddit_id = $1 ORDER BY created_at DESC',[subId]);
    res.json(posts.rows); 
  } catch (e) {
    console.error('Could not fetch posts due to:', e);
    res.status(500).send('Server error'); 
  }
});

app.put('/subreddits/:id/posts/:postId', async (req, res) => {
  const subId = req.params.id; 
  const postId = req.params.postId; 
  const { title, content } = req.body; 
  console.log('Updating post:', {subredditId: subId, postId,title, content});
  try {
    const post = await pg.query('UPDATE posts SET title = $1, content = $2 WHERE post_id = $3 AND subreddit_id = $4 RETURNING *',
      [title, content, postId, subId]);
    if (post.rowCount === 0) {
      return res.status(404).send('Post not found');
    }
    console.log('Post updated:', post.rows[0]);
    res.status(200).json(post.rows[0]);
  } catch (e) {
    console.log('Issue updating post:', e);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

app.post('/subreddits/:id/posts', async (req, res) => {
  const { post_id, title, content, userId } = req.body; 
  const subId = req.params.id; 
  console.log('Creating post:', {subredditId: subId, title, content, userId});
  try {
    const post = await pg.query('INSERT INTO posts (post_id, subreddit_id, user_id, title, content) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [post_id, subId, userId, title, content] );
    console.log('Post created:', post.rows[0]);
    res.status(201).json(post.rows[0]); 
  } catch (e) {
    console.log('Issue creating post:', e);
    res.status(500).send('Server error');
  }
});

app.delete('/subreddits/:id/posts/:post_id', async (req, res) => {
  const {post_id, title} = req.body;
  try {
    const del = await pg.query('DELETE FROM posts WHERE post_id = $1 AND title = $2', [post_id, title]);
    console.log('Deleted post: ', title);
    res.status(201).send('Successfully deleted post');
  } catch (e) {
    console.log('Issue deleting post: ', e);
    res.status(500).send('Server error');
  }
});

app.post('/subreddits/:subreddit_id/posts/:post_id/upvote', async (req, res) => {
  const postId = req.params.post_id;
  const userId = req.body.user_id;
  try {
    const begin = await pg.query('BEGIN');
    const existingVoteQuery = await pg.query(
      'SELECT vote_type FROM votes WHERE user_id = $1 AND post_id = $2',
      [userId, postId]
    );
    if (existingVoteQuery.rows.length > 0) {
      const existingVote = existingVoteQuery.rows[0];
      if (existingVote.vote_type === 1) { //if already upvoted, reset
        const del = await pg.query('DELETE FROM votes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
        const update = await pg.query('UPDATE posts SET karma = karma - 1 WHERE post_id = $1', [postId]);
        await pg.query('COMMIT');
        return res.json({ message: 'Upvote removed', karma_change: -1 });
      } else if (existingVote.vote_type === -1) { //if downvoted, reset the downvote and upvote
        const change = await pg.query('UPDATE votes SET vote_type = 1 WHERE user_id = $1 AND post_id = $2', [userId, postId]);
        const update = await pg.query('UPDATE posts SET karma = karma + 2 WHERE post_id = $1', [postId]);
        const commit = await pg.query('COMMIT');
        return res.json({ message: 'Changed from downvote to upvote', karma_change: 2 });
      }
    } else { //create upvote
      const insert = await pg.query('INSERT INTO votes (user_id, post_id, vote_type) VALUES ($1, $2, 1)', [userId, postId]);
      const update = await pg.query('UPDATE posts SET karma = karma + 1 WHERE post_id = $1', [postId]);
      const commit = await pg.query('COMMIT');
      return res.json({ message: 'Upvoted successfully', karma_change: 1 });
    }
  } catch (e) {
    const roll = await pg.query('ROLLBACK');
    console.log('Error in upvote operation:', e);
    res.status(500).send('Server error');
  }
});

app.post('/subreddits/:subreddit_id/posts/:post_id/downvote', async (req, res) => {
  const postId = req.params.post_id;
  const userId = req.body.user_id;
  try {
    await pg.query('BEGIN');
    const existingVoteQuery = await pg.query('SELECT vote_type FROM votes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
    if (existingVoteQuery.rows.length > 0) {
      const existingVote = existingVoteQuery.rows[0];
      if (existingVote.vote_type === -1) { //if already downvoted, reset
        const del = await pg.query('DELETE FROM votes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
        const update = await pg.query('UPDATE posts SET karma = karma + 1 WHERE post_id = $1', [postId]);
        const commit = await pg.query('COMMIT');
        return res.json({ message: 'Downvote removed', karma_change: 1 });
      } else if (existingVote.vote_type === 1) { //if upvoted, rest upvote and downvote
        const update = await pg.query('UPDATE votes SET vote_type = -1 WHERE user_id = $1 AND post_id = $2', [userId, postId]);
        const change = await pg.query('UPDATE posts SET karma = karma - 2 WHERE post_id = $1', [postId]);
        const commit = await pg.query('COMMIT');
        return res.json({ message: 'Changed from upvote to downvote', karma_change: -2 });
      }
    } else { //create downvote
      const insert = await pg.query('INSERT INTO votes (user_id, post_id, vote_type) VALUES ($1, $2, -1)', [userId, postId]);
      const update = await pg.query('UPDATE posts SET karma = karma - 1 WHERE post_id = $1', [postId]);
      const commit = await pg.query('COMMIT');
      return res.json({ message: 'Downvoted successfully', karma_change: -1 });
    }
  } catch (e) {
    const roll = await pg.query('ROLLBACK');
    console.log('Error in downvote operation:', e);
    res.status(500).send('Server error');
  }
});

app.post('/subreddits/:id/posts/:post_id/comment', async (req, res) => {
  const postId = req.params.post_id; 
  const userId = req.body.userId; 
  const description = req.body.description; 
  try {
    const post = await pg.query('INSERT INTO comments (post_id, user_id, description) VALUES ($1, $2, $3) RETURNING *', [postId, userId, description]);
    console.log('Comment added:', post.rows[0]);
    res.status(201).json(post.rows[0]); 
  } catch (e) {
    console.log('Error adding comment:', e);
    res.status(500).send('Server error');
  }
});

app.put('/subreddits/:id/posts/:post_id/comment', async (req, res) => {
  const postId = req.params.post_id; 
  const {commentId, description} = req.body;  
  try {
    const comment = await pg.query('UPDATE comments SET description = $1 WHERE post_id = $2 AND comment_id = $3 RETURNING *',
      [description, postId, commentId]);
    if (comment.rowCount === 0) {
      return res.status(404).send('Comment not found');
    }
    console.log('Comment updated:', comment.rows[0]);
    res.status(200).json(comment.rows[0]);
  } catch (e) {
    console.log('Error updating comment:', e);
    res.status(500).send('Server error');
  }
});

app.delete('/subreddits/:id/posts/:post_id/comment', async (req, res) => {
  const postId = req.params.post_id; 
  const commentId = req.body.commentId; 
  try {
    const comment = await pg.query('DELETE FROM comments WHERE post_id = $1 AND comment_id = $2 RETURNING *', [postId, commentId]);
    if (comment.rowCount === 0) {
      return res.status(404).send('Comment not found');
    }
    console.log('Comment deleted:', comment.rows[0]);
    res.status(204).send("Comment deleted successfully"); 
  } catch (e) {
    console.log('Error deleting comment:', e);
    res.status(500).send('Server error');
  }
});

app.post('/users/register', async (req, res) => {
  const { username, password, user_id } = req.body;
  const hashedPassword = await bcrypt.hash(password, 20); 
  try {
    const login = await pg.query('INSERT INTO users (user_id, username, password) VALUES ($1, $2, $3) RETURNING *', 
      [user_id, username, hashedPassword]);
    console.log("Registered successfully");
    res.status(201).json(login.rows[0]); // Successful registration endpoint response
  } catch (e) {
    console.log(e);
    res.status(500).send('Server error'); 
  }
});

app.post('/users/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const login = await pg.query('SELECT * FROM users WHERE username = $1', [username]); // Fetch user credentials from db
    const user = login.rows[0];
    if (user && await bcrypt.compare(password, user.password)) { // Validate credentials
      const token = json.sign({ id: user.user_id }, 'login_token', { expiresIn: '8h' }); 
      console.log("Login successful");
      const userData = await fetchUserData(user.user_id);
      res.json({ token, userData }); 
    } else {
      res.status(401).send('Invalid login credentials, please try again'); 
    }
  } catch (e) {
    console.log(e);
    res.status(500).send('Server error'); 
  }
});

app.put('/users', async (req, res) => {
  const { userId, username, password } = req.body; 
  let updates = [];
  let values = [];
  if (username) {
    updates.push(`username = $${updates.length + 1}`);
    values.push(username);
  }
  if (password) {
    const hashedPassword = await bcrypt.hash(password, 20);
    updates.push(`password = $${updates.length + 1}`);
    values.push(hashedPassword);
  }
  if (updates.length === 0) {
    return res.status(400).send('No updates provided');
  }
  values.push(userId); 
  try {
    const user = await pg.query(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = $${values.length} RETURNING *`,
      values
    );
    if (user.rowCount === 0) {
      return res.status(404).send('User not found');
    }
    console.log('User updated:', user.rows[0]);
    res.status(200).json(user.rows[0]);
  } catch (e) {
    console.error('Error updating user:', e);
    res.status(500).send('Server error');
  }
});

app.delete('/users', async (req, res) => {
  const userId = req.body.userId; 
  try {
    const user = await pg.query('DELETE FROM users WHERE user_id = $1 RETURNING *', [userId]);
    if (user.rowCount === 0) {
      return res.status(404).send('User not found');
    }
    console.log('User deleted:', user.rows[0]);
    res.status(204).send("User deleted successfully"); 
  } catch (e) {
    console.log('Error deleting user:', e);
    res.status(500).send('Server error');
  }
});

async function fetchUserData(userId) {
  try { 
    const sub = await pg.query( //s. is an alias for the subreddits table
      'SELECT s.subreddit_id, s.name FROM subreddits s JOIN subscriptions us ON s.subreddit_id = us.subreddit_id WHERE us.user_id = $1',
      [userId]
    );
    const post = await pg.query( //p. is an alias for the posts table
      'SELECT p.post_id, p.title, p.content, p.karma FROM posts p WHERE p.user_id = $1',
      [userId]
    );
    return {subscriptions: sub.rows, posts: post.rows,};
  } catch (e) {
    console.log('Error fetching user subscriptions and posts:', e);
    throw new Error('Failed to retrieve user data');
  }
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`); 
});
