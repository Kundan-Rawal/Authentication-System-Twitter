const express = require('express')
const path = require('path')

const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const app = express()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error:  ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

//authentication middleware
const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        await response.status(401)
        await response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

//registeruserapi
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = await request.body
  // console.log(request.body)
  const hashedPassword = await bcrypt.hash(request.body.password, 10)
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined && request.body.password.length >= 6) {
    const createUserQuery = `
      INSERT INTO
        user (username,password, name, gender)
      VALUES
        (
          '${username}',
          '${hashedPassword}',
          '${name}',
          '${gender}'
        );`
    const dbResponse = await db.run(createUserQuery)
    response.status = 200
    response.send(`User created successfully`)
  } else if (dbUser === undefined && password.length < 6) {
    response.status = 400
    response.send('Password is too short')
  } else {
    response.status = 400
    response.send('User already exists')
  }
})

//loginuserid
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
      console.log(request.body)
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {username} = await request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
  const getUserId = await db.get(getUserIdQuery)
  const getTweetsQuery = `
     SELECT 
       user.username, tweet.tweet, tweet.date_time AS dateTime
     FROM 
       follower 
       INNER JOIN tweet ON follower.following_user_id = tweet.user_id
       INNER JOIN user ON tweet.user_id = user.user_id
     WHERE 
       follower.follower_user_id = ${getUserId.user_id}
     ORDER BY 
       tweet.date_time DESC
     LIMIT 4;
   `
  const tweetsArray = await db.all(getTweetsQuery)

  function converter(tweet) {
    return {
      username: tweet.username,
      tweet: tweet.tweet,
      dateTime: tweet.dateTime,
    }
  }

  response.send(tweetsArray.map(tweet => converter(tweet)))
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {username} = await request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
  const getUserId = await db.get(getUserIdQuery)
  const getTweetsQuery = `
     SELECT 
       distinct name from user inner join follower on follower_user_id=user_id and username != '${request.username}';`
  const tweetsArray = await db.all(getTweetsQuery)
  // console.log(tweetsArray)
  response.send(tweetsArray)
})

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {username} = await request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
  const getUserId = await db.get(getUserIdQuery)
  const getTweetsQuery = `
     SELECT 
      tweet,
      COUNT(DISTINCT like.like_id) AS likes,
      COUNT(DISTINCT reply.reply_id) AS replies,
      tweet.date_time AS dateTime
    FROM tweet
    LEFT JOIN like ON tweet.tweet_id = like.tweet_id
    LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.user_id = ${getUserId.user_id}
    GROUP BY tweet.tweet_id
    ORDER BY tweet.date_time DESC;`
  const tweetsArray = await db.all(getTweetsQuery)
  console.log(tweetsArray)
  response.send(tweetsArray)
})

app.get('/tweets/:tweetId/', authenticateToken, async (request, response) => {
  const {tweetId} = request.params
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
  const getUserId = await db.get(getUserIdQuery)
  const getverifiedQuery = `
      SELECT following_user_id  FROM follower
      where follower_user_id=${getUserId.user_id}`
  const tweetsArray = await db.all(getverifiedQuery)
  let verificationarray = []
  for (let i of tweetsArray) {
    verificationarray.push(i.following_user_id)
  }
  console.log(verificationarray)
  const tweetDetailsQuery = `
      SELECT 
        tweet.user_id,
        tweet.tweet,
        COUNT(DISTINCT like.like_id) AS likes,
        COUNT(DISTINCT reply.reply_id) AS replies,
        date_time AS dateTime
      FROM tweet
      LEFT JOIN like ON tweet.tweet_id = like.tweet_id
      LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
      WHERE tweet.tweet_id = ${tweetId};
    `
  const tweetsfinallarray = await db.get(tweetDetailsQuery)

  // console.log(tweetsArray)
  if (tweetsfinallarray.user_id in verificationarray) {
    response.send({
      tweet: tweetsfinallarray.tweet,
      likes: tweetsfinallarray.likes,
      replies: tweetsfinallarray.replies,
      dateTime: tweetsfinallarray.dateTime,
    })
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = await request
    const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
    const getUserId = await db.get(getUserIdQuery)

    const getFollowingUsersQuery = `
     SELECT following_user_id 
     FROM follower 
     WHERE follower_user_id=${getUserId.user_id}`

    const followingUsersArray = await db.all(getFollowingUsersQuery)

    const tweetdetquery = `select user_id from tweet where tweet_id=${tweetId};`
    const tweetDetails = await db.get(tweetdetquery)

    const isFollowing = followingUsersArray.some(
      each => each.following_user_id === tweetDetails.user_id,
    )

    const likesQuery = `
      SELECT user.username
      FROM like
      INNER JOIN user ON like.user_id = user.user_id
      WHERE like.tweet_id = ${tweetId};
    `

    const likesArray = await db.all(likesQuery)

    if (isFollowing) {
      response.send({
        likes: likesArray.map(each => each.username),
      })
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const {username} = await request
    const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
    const getUserId = await db.get(getUserIdQuery)
    const query = `
    SELECT * 
    FROM tweet 
    INNER JOIN follower 
      ON tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = ${tweetId} 
      AND follower.follower_user_id = ${getUserId.user_id};
  `
    const tweet = await db.get(query)

    if (tweet === undefined) {
      response.status(401).send('Invalid Request')
    } else {
      // Fetch replies for the tweet
      const repliesQuery = `
      SELECT user.name AS name, reply.reply AS reply 
      FROM reply 
      INNER JOIN user 
        ON reply.user_id = user.user_id 
      WHERE reply.tweet_id = ${tweetId};
    `
      const replies = await db.all(repliesQuery)
      response.send({replies})
    }
  },
)

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = await request.body
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
  const getUserId = await db.get(getUserIdQuery)
  const user_id = getUserId.user_id

  const insertquerry = `insert into tweet (tweet,user_id) values("${tweet}",${user_id});`
  await db.run(insertquerry)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {tweetId} = request.params
    const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
    const getUserId = await db.get(getUserIdQuery)
    const user_id = getUserId.user_id

    const tweetQuery = `
    SELECT * 
    FROM tweet 
    WHERE tweet_id = ${tweetId} AND user_id = ${user_id};
  `
    const tweet = await db.get(tweetQuery)

    if (tweet === undefined) {
      // The tweet does not belong to the logged-in user
      response.status(401).send('Invalid Request')
    } else {
      // Delete the tweet
      const deleteTweetQuery = `
      DELETE FROM tweet 
      WHERE tweet_id = ${tweetId};
    `
      await db.run(deleteTweetQuery)
      response.send('Tweet Removed')
    }
  },
)

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {username} = await request
  const getUserIdQuery = `SELECT user_id FROM user WHERE username='${request.username}';`
  const getUserId = await db.get(getUserIdQuery)
  const getTweetsQuery = `
     SELECT name FROM user WHERE user_id IN ( SELECT follower_user_id FROM follower WHERE following_user_id = ${getUserId.user_id} );`
  const tweetsArray = await db.all(getTweetsQuery)
  // console.log(tweetsArray)
  let follower_user_idreqfetch = []
  for (let i of tweetsArray) {
    follower_user_idreqfetch.push(i.follower_user_id)
  }
  const allquery = `select * from user inner join follower on following_user_id=user_id`
  response.send(tweetsArray)
})

// app.delete(
//   '/districts/:districtId',
//   authenticateToken,
//   async (request, response) => {
//     const {districtId} = request.params
//     const deletemoviequery = `DELETE FROM district where district_id=${districtId};`
//     await db.run(deletemoviequery)
//     response.send('District Removed')
//   },
// )

// app.put(
//   '/districts/:districtId',
//   authenticateToken,
//   async (request, response) => {
//     const {districtId} = await request.params
//     const districtdetails = await request.body
//     const {districtName, stateId, cases, cured, active, deaths} =
//       districtdetails
//     const updatemoviequerry = `update district set district_id=${districtId},district_name="${districtName}",state_id=${stateId},cases=${cases},cured=${cured},active=${active},deaths=${deaths} where district_id=${districtId};`
//     const dbresponse = await db.run(updatemoviequerry)
//     response.send('District Details Updated')
//   },
// )

// app.get(
//   '/states/:stateId/stats/',
//   authenticateToken,
//   async (request, response) => {
//     const {stateId} = request.params
//     const getstatesquery = `select sum(cases) as totalCases,sum(cured) as totalCured,sum(active) as totalActive,sum(deaths) as totalDeaths  from state left join district on state.state_id=district.state_id where state.state_id=${stateId};`
//     const dirarray = await db.get(getstatesquery)
//     response.send(dirarray)
//   },
// )

// app.get(
//   '/districts/:districtId/details/',
//   authenticateToken,
//   async (request, response) => {
//     const {districtId} = request.params
//     const getdissquery = `select * from state left join district on state.state_id=district.state_id where district.district_id=${districtId};`
//     const dirarray = await db.get(getdissquery)
//     response.send({
//       stateName: dirarray.state_name,
//     })
//   },
// )

module.exports = app
