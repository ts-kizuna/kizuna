import express from 'express';
import { findUser, pageUsers, users } from '../data';

const app = express();
app.use(express.json());

app.get('/users/:id', (req, res) => {
    const user = findUser(req.params.id);
    if (!user) {
        res.status(404).json({
            detail: 'User not found',
        });
        return;
    }
    res.json(user);
});

app.get('/users', (req, res) => {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    res.json({
        users: pageUsers(page, limit),
        total: users.length,
    });
});

app.post('/users', (req, res) => {
    res.status(201).json({
        id: 'user-created',
        name: req.body.name,
        email: req.body.email,
    });
});

app.listen(Number(process.env.PORT));
