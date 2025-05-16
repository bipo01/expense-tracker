import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import session from "express-session";
import http from "http";
import { Server } from "socket.io";

import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

env.config();
const app = express();
const port = 3000;
const server = http.createServer(app);
const io = new Server(server);

const db = new pg.Client({
  connectionString: process.env.PG_URL,
});
db.connect();

io.on("connection", (socket) => {
  socket.on("new-sheet", async (data) => {
    const sheet = data.sheetName;
    const user_id = Number(data.user_id);

    const result = await db.query(
      "INSERT INTO etsheets(sheet, users_id, adm_id) VALUES($1,$2,$3) RETURNING *",
      [sheet, [user_id], user_id]
    );
    const newSheet = result.rows[0];

    socket.emit("new-sheet", newSheet);
  });

  socket.on("add-move", async (data) => {
    const type = data.type;
    const value = data.value;
    const category = data.category;
    const description = data.description;
    const date = data.date;
    const user_id = data.user_id;
    const sheet_id = data.sheet_id;
    const user_name = data.user_name;

    const newMoveResult = await db.query(
      "INSERT INTO etmoves(type, user_id, category, value, description, date, sheet_id, user_name) VALUES($1,$2,$3,$4,$5,$6, $7, $8) RETURNING *",
      [type, user_id, category, value, description, date, sheet_id, user_name]
    );
    const newMove = newMoveResult.rows[0];

    io.emit("add-move", newMove);
  });

  socket.on("new-category", (data) => {
    const sheet_id = Number(data.sheet_id);
    const category = data.category;

    db.query(
      "UPDATE etsheets SET categories = categories || $1 WHERE id = $2",
      [`{${category}}`, sheet_id]
    );

    io.emit("new-category", { sheet_id, category });
  });

  socket.on("remove-category", async (data) => {
    const { sheet_id, category } = data;

    db.query(
      "UPDATE etsheets SET categories = array_remove(categories, $1) WHERE id = $2",
      [category, sheet_id]
    );

    db.query(
      "UPDATE etmoves SET category = $1 WHERE category = $2 AND sheet_id = $3",
      ["Sem categoria", category, sheet_id]
    );

    io.emit("remove-category", { sheet_id, category });
  });

  socket.on("new-user", async (data) => {
    const sheet_id = Number(data.sheet_id);
    const username = data.username;

    console.log(username);

    const userResult = await db.query(
      "SELECT * FROM etusers WHERE username = $1",
      [username]
    );

    console.log(userResult);
    const user = userResult.rows[0];

    console.log(user);

    if (user) {
      db.query("UPDATE etsheets SET users_id = users_id || $1 WHERE id = $2", [
        `{${user.id}}`,
        sheet_id,
      ]);

      delete user.password;

      const userId = Number(user.id);

      const userEntriesResult = await db.query(
        "SELECT value FROM etmoves WHERE user_id = $1 AND sheet_id = $2 AND type = $3",
        [userId, sheet_id, "Entrada"]
      );
      const userEntries = userEntriesResult.rows.map((el) => Number(el.value));

      const personEntries = userEntries.reduce((acc, cur) => acc + cur, 0);

      const userExpensesResult = await db.query(
        "SELECT value FROM etmoves WHERE user_id = $1 AND sheet_id = $2 AND type = $3",
        [userId, sheet_id, "Saída"]
      );
      const userExpenses = userExpensesResult.rows.map((el) =>
        Number(el.value)
      );

      const personExpenses = userExpenses.reduce((acc, cur) => acc + cur, 0);

      const person = {
        id: userId,
        name: user.name,
        username: user.username,
        entries: personEntries,
        expenses: personExpenses,
        total: Number(personEntries - personExpenses),
      };

      io.emit("new-user", { sheet_id, person });
    } else {
      socket.emit("new-user", "User não existe");
    }
  });

  socket.on("edit-row", async (data) => {
    const category = data.categoryValue;
    const type = data.typeValue;
    const value = data.valueValue;
    const description = data.descriptionValue;
    const date = data.rawDate;
    const user_id = Number(data.user_id);
    const sheet_id = Number(data.sheet_id);
    const move_id = Number(data.move_id);

    const result = await db.query(
      "UPDATE etmoves SET category = $1, type = $2, value = $3, description = $4, date = $5 WHERE id = $6 RETURNING *",
      [category, type, value, description, date, move_id]
    );
    const move = result.rows[0];

    io.emit("edit_row", move);
  });

  socket.on("search-user", async (data) => {
    const { newUser } = data;

    const result = await db.query(
      "SELECT * FROM etusers WHERE username ILIKE $1 OR name ILIKE $2",
      [`%${newUser}%`, `%${newUser}%`]
    );
    const users = result.rows;

    users.forEach((user) => {
      delete user.password;
    });

    socket.emit("search-user", { users });
  });

  socket.on("remove-user", (data) => {
    const { sheet_id, person_id } = data;

    db.query(
      "UPDATE etsheets SET users_id = array_remove(users_id, $1) WHERE id = $2",
      [person_id, sheet_id]
    );

    io.emit("remove-user", { person_id, sheet_id });
  });

  socket.on("remove-all-moves", (data) => {
    console.log(data);
    const { allPersonMoves } = data;

    db.query("DELETE FROM etmoves WHERE id = ANY($1)", [allPersonMoves]);
  });

  socket.on("get-new-sheet", async (data) => {
    const sheet_id = data.newSheetId;

    const result = await db.query("SELECT * FROM etsheets WHERE id = $1", [
      sheet_id,
    ]);
    const sheet = result.rows[0];

    socket.emit("get-new-sheet", sheet);
  });

  socket.on("delete-sheet", (data) => {
    const { sheet_id } = data;

    db.query("DELETE FROM etsheets WHERE id = $1", [sheet_id]);

    io.emit("delete-sheet", { sheet_id });
  });

  socket.on("remove-move", (data) => {
    const move_id = data;

    db.query("DELETE FROM etmoves WHERE id = $1", [move_id]);

    io.emit("remove-move", move_id);
  });

  socket.on("leave-sheet", (data) => {
    const { sheet_id, user_id } = data;

    db.query(
      "UPDATE etsheets SET users_id = array_remove(users_id, $1) WHERE id = $2",
      [user_id, sheet_id]
    );

    io.emit("leave-sheet", { sheet_id, person_id: user_id });
  });
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  session({
    resave: false,
    saveUninitialized: false,
    secret: process.env.EXPRESS_SESSION_SECRET,
    cookie: { secure: false },
  })
);

app.get("/", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const allSheetsResult = await db.query(
    "SELECT * FROM etsheets WHERE users_id @> $1",
    [`{${req.session.user.id}}`]
  );
  const allSheets = allSheetsResult.rows;

  return res.render("allSheets.ejs", {
    allSheets,
    user_id: req.session.user.id,
  });
});

app.get("/home", (req, res) => {
  return res.redirect("/");
});

app.post("/home", async (req, res) => {
  if (!req.session.user) return res.redirect("/login");

  const sheet_id = Number(req.body.sheet_id);

  const sheetResult = await db.query("SELECT * FROM etsheets WHERE id = $1", [
    sheet_id,
  ]);
  const sheet = sheetResult.rows[0];

  const movesResult = await db.query(
    "SELECT * FROM etmoves WHERE sheet_id = $1 ORDER BY id DESC",
    [sheet_id]
  );
  const moves = movesResult.rows;
  moves.sort((a, b) => {
    const aDateArr = a.date.split("/");
    const aDate = new Date(`${aDateArr[2]}-${aDateArr[1]}-${aDateArr[0]}`);

    const bDateArr = b.date.split("/");
    const bDate = new Date(`${bDateArr[2]}-${bDateArr[1]}-${bDateArr[0]}`);

    return bDate - aDate;
  });

  const user_id = req.session.user.id;
  const user_username = req.session.user.username;
  const user_name = req.session.user.name;

  const categories = sheet.categories || [];
  const users_id = sheet.users_id || [];

  if (!users_id.includes(user_id)) return res.redirect("/");

  const people = [];

  for (const userId of users_id) {
    const userResult = await db.query("SELECT * FROM etusers WHERE id = $1", [
      userId,
    ]);
    const user = userResult.rows[0];

    const userEntriesResult = await db.query(
      "SELECT value FROM etmoves WHERE user_id = $1 AND sheet_id = $2 AND type = $3",
      [userId, sheet_id, "Entrada"]
    );
    const userEntries = userEntriesResult.rows.map((el) => Number(el.value));

    const personEntries = userEntries.reduce((acc, cur) => acc + cur, 0);

    const userExpensesResult = await db.query(
      "SELECT value FROM etmoves WHERE user_id = $1 AND sheet_id = $2 AND type = $3",
      [userId, sheet_id, "Saída"]
    );
    const userExpenses = userExpensesResult.rows.map((el) => Number(el.value));

    const personExpenses = userExpenses.reduce((acc, cur) => acc + cur, 0);

    const person = {
      id: userId,
      name: user.name,
      username: user.username,
      entries: personEntries,
      expenses: personExpenses,
      total: Number(personEntries - personExpenses),
    };

    people.push(person);
  }

  people.sort((a, b) => b.total - a.total);

  res.render("home.ejs", {
    sheet,
    moves,
    user_id,
    user_username,
    user_name,
    sheet_id,
    categories,
    people,
  });
});

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/register", (req, res) => {
  res.render("register.ejs");
});

app.post("/login", async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  const result = await db.query("SELECT * FROM etusers WHERE username = $1", [
    username,
  ]);
  const user = result.rows[0];

  if (!user) return res.redirect("/register");

  if (user.password != password) return res.redirect("/login");

  req.session.user = user;

  return res.redirect("/");
});

app.post("/register", async (req, res) => {
  const fName = req.body.fName.trim();
  const lName = req.body.lName.trim();
  const name = `${fName} ${lName}`;
  const username = req.body.username;
  const password = req.body.password;

  const userExists = await db.query(
    "SELECT * FROM etusers WHERE username = $1",
    [username]
  );

  if (userExists.rows[0]) return res.redirect("/login");

  const newUserResult = await db.query(
    "INSERT INTO etusers (name, username, password) VALUES($1,$2,$3) RETURNING *",
    [name, username, password]
  );
  const newUser = newUserResult.rows[0];

  req.session.user = newUser;

  return res.redirect("/");
});

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.redirect("/");

    res.clearCookie("connection.sid");
    return res.redirect("/login");
  });
});

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
