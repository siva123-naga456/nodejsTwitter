const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const dbPath = path.join(__dirname, "twitterClone.db");

const app = express();
app.use(express.json());
let db = null;

const datBaseConnection = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    //app.listen(3000);
  } catch (e) {
    console.log(e);
  }
};
datBaseConnection();

//API1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const dbUser = await db.get(
    `select * from user where username="${username}"`
  );
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      await db.run(
        `insert into user(username,password,gender,name) values("${username}","${hashedPassword}","${gender}","${name}")`
      );
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//API2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const dbUser = await db.get(
    `select * from user where username="${username}"`
  );
  if (dbUser !== undefined) {
    const matchPassword = await bcrypt.compare(password, dbUser.password);
    if (matchPassword) {
      let jwtToken = jwt.sign(username, "My_SECRET");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

//Authentication
function AuthenticationToken(request, response, next) {
  let jwtToken;
  const authorization = request.headers["authorization"];
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "My_SECRET", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload;
        next();
      }
    });
  }
}

const tweetResponse = (each) => ({
  username: each.username,
  tweet: each.tweet,
  dateTime: each.date_time,
});

//API 3
app.get(
  "/user/tweets/feed/",
  AuthenticationToken,
  async (request, response) => {
    const latestTweet = await db.all(`
    select 
    tweet.tweet_id,
    tweet.user_id,
    user.username,
    tweet.tweet,
    tweet.date_time
    from follower
    left join tweet on tweet.user_id=follower.following_user_id 
    left join user on follower.following_user_id=user.user_id
    where follower.follower_user_id=(select user_id from user where username="${request.username}") 
    order by tweet.date_time desc
    limit 4;`);
    response.send(latestTweet.map((each) => tweetResponse(each)));
  }
);

//API 4
app.get("/user/following/", AuthenticationToken, async (request, response) => {
  const following = await db.all(`select user.name
    from follower left join user on follower.following_user_id=user.user_id
    where follower.follower_user_id=(select user_id from user where username="${request.username}") `);
  response.send(following);
});

//API 5

app.get("/user/followers/", AuthenticationToken, async (request, response) => {
  const followers = await db.all(`select user.name
    from follower left join user on follower.follower_user_id=user.user_id
    where follower.following_user_id=(select user_id from user where username="${request.username}") `);
  response.send(followers);
});

const idCheck = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(`select * from follower where follower_user_id=(select user_id from user where username="${request.username}")
     and following_user_id=(select user.user_id from tweet natural join user where tweet_id=${tweetId})`);
  if (isFollowing === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API 6
app.get(
  "/tweets/:tweetId/",
  AuthenticationToken,
  idCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const { tweet, date_time } = await db.get(
      `select tweet,date_time from tweet where tweet_id=${tweetId}`
    );
    const { likes } = await db.get(
      `select count(like_id) as likes tweet,date_time from like where tweet_id=${tweetId}`
    );
    const { replies } = await db.get(
      `select count(reply_id) as replies tweet,date_time from reply where tweet_id=${tweetId}`
    );
    response.send({ tweet, likes, replies, dateTime: date_time });
  }
);

//API7
app.get(
  "/tweets/:tweetId/likes/",
  AuthenticationToken,
  idCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const likeBy = await db.all(
      `select user.username from like natural join user where tweet_id=${tweetId}`
    );
    response.send({ likes: likeBy.map((each) => each.username) });
  }
);

//ApI 8
app.get(
  "/tweets/:tweetId/replies/",
  AuthenticationToken,
  idCheck,
  async (request, response) => {
    const { tweetId } = request.params;
    const replies = await db.all(
      `select user.name, reply.reply from reply natural join user where tweet_id=${tweetId}`
    );
    response.send({ replies });
  }
);

//API 9
app.get("/user/tweets/", AuthenticationToken, async (request, response) => {
  const { tweetId } = request.params;
  const MyTweets = await db.all(`select tweet.tweet,count(distinct like.like_id) as likes,
    count(distinct reply.reply_id) as replies,
    tweet.date_time from tweet left join like on tweet.tweet_id=like.tweet_id 
    left join reply on tweet.tweet_id=reply.tweet_id 
    where tweet.user_id=(select user_id from user where username="${request.username}") group by tweet.tweet_id`);
  response.send(
    MyTweets.map((each) => {
      const { date_time, ...rest } = each;
      return { ...rest, dateTime: date - time };
    })
  );
});

//API 10
app.post("/user/tweets/", AuthenticationToken, async (request, response) => {
  const { tweet } = request.body;
  const { user_id } = await db.get(
    `select user_id from user where username="${request.username}"`
  );
  await db.run(
    `insert into tweet(tweet,user_id) values("${tweet}",${user_id})`
  );
  response.send("Created a Tweet");
});

//API  11
app.delete(
  "/tweets/:tweetId/",
  AuthenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const deleteTweet = await db.get(`select tweet_id,user_id from tweet where tweet_id=${tweetId}
    and user_id=(select user_id from user where username="${request.username}")`);
    if (deleteTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      await db.run(`delete from tweet where tweet_id=${tweetId}`);
    }
    response.send("Tweet Removed");
  }
);

module.exports = app;
