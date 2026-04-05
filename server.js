const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// servir frontend
app.use(express.static(__dirname + '/public'));


// =======================
// CONEXIÓN MYSQL (HÍBRIDA)
// =======================
const db = mysql.createConnection({
    host: process.env.MYSQLHOST || 'localhost',
    user: process.env.MYSQLUSER || 'root',
    password: process.env.MYSQLPASSWORD || '123456',
    database: process.env.MYSQLDATABASE || 'el_buen_precio',
    port: process.env.MYSQLPORT || 3306
});

// conectar a la base de datos
db.connect(err => {
    if (err) {
        console.error('❌ Error de conexión:', err);
    } else {
        console.log('✅ Conectado a MySQL');
    }
});


// =======================
// RUTA DE PRUEBA
// =======================
app.get('/', (req, res) => {
    res.send('Servidor funcionando 🚀');
});


// ================= CLIENTES =================

app.get('/clientes', (req, res) => {
    db.query(`
        SELECT 
            c.id,
            c.nombre,
            c.apellido1,
            c.apellido2,
            c.cedula,
            c.telefono,
            c.estado,

            IFNULL((
                SELECT SUM(valor) 
                FROM creditos 
                WHERE cliente_id = c.id AND estado = "pendiente"
            ),0) AS saldo,

            MAX(ab.fecha) AS ultimaFecha

        FROM clientes c
        LEFT JOIN abonos ab ON c.id = ab.cliente_id

        GROUP BY c.id
    `, (err, result) => {
        if (err) res.send(err);
        else res.json(result);
    });
});

app.post('/clientes', (req, res) => {
    const { nombre, apellido1, apellido2, cedula, telefono, saldo, estado } = req.body;
    db.query(
        'INSERT INTO clientes (nombre, apellido1, apellido2, cedula, telefono, saldo, estado) VALUES (?,?,?,?,?,?,?)',
        [nombre, apellido1, apellido2, cedula, telefono, saldo, estado],
        (err, result) => {
            if(err) res.send(err);
            else res.json({ message: 'Cliente creado', id: result.insertId });
        }
    );
});

app.put('/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, apellido1, apellido2, cedula, telefono, saldo, estado } = req.body;
    db.query(
        'UPDATE clientes SET nombre=?, apellido1=?, apellido2=?, cedula=?, telefono=?, saldo=?, estado=? WHERE id=?',
        [nombre, apellido1, apellido2, cedula, telefono, saldo, estado, id],
        (err, result) => {
            if(err) res.send(err);
            else res.json({ message: 'Cliente actualizado' });
        }
    );
});

app.delete('/clientes/:id', (req, res) => {
    const { id } = req.params;

    db.query('DELETE FROM abonos WHERE cliente_id=?', [id], (err) => {
        if (err) return res.send(err);

        db.query('DELETE FROM creditos WHERE cliente_id=?', [id], (err) => {
            if (err) return res.send(err);

            db.query('DELETE FROM clientes WHERE id=?', [id], (err) => {
                if (err) return res.send(err);

                res.json({ message: 'Cliente eliminado correctamente ✅' });
            });
        });
    });
});


// ================= CRÉDITOS =================

app.get('/creditos', (req, res) => {
    db.query(
        `SELECT 
            creditos.id,
            creditos.cliente_id AS clienteId,
            creditos.producto,
            creditos.valor AS monto,
            creditos.estado,
            creditos.fecha,
            clientes.nombre,
            clientes.apellido1,
            clientes.apellido2,
            clientes.cedula
        FROM creditos
        JOIN clientes ON creditos.cliente_id = clientes.id`,
        (err, result) => {
            if (err) res.send(err);
            else res.json(result);
        }
    );
});

app.get('/creditos/cliente/:id', (req, res) => {
    const { id } = req.params;

    db.query(
        `SELECT 
            creditos.id,
            creditos.cliente_id AS clienteId,
            creditos.producto,
            creditos.valor AS monto,
            creditos.estado,
            creditos.fecha,
            clientes.nombre,
            clientes.apellido1,
            clientes.apellido2
        FROM creditos
        JOIN clientes ON creditos.cliente_id = clientes.id
        WHERE clientes.id = ?`,
        [id],
        (err, result) => {
            if(err) res.send(err);
            else res.json(result);
        }
    );
});

app.post('/creditos', (req, res) => {
    const { clienteId, producto, monto } = req.body;

    db.query(
        'INSERT INTO creditos (cliente_id, producto, valor, estado) VALUES (?,?,?, "pendiente")',
        [clienteId, producto, monto],
        (err, result) => {
            if(err) res.send(err);
            else res.json({ message: 'Crédito creado', id: result.insertId });
        }
    );
});

app.delete('/creditos/:id', (req, res) => {
    const { id } = req.params;

    db.query(
        'DELETE FROM creditos WHERE id=?',
        [id],
        (err, result) => {
            if(err) res.send(err);
            else res.json({ message: 'Crédito eliminado' });
        }
    );
});


// ================= ABONO GENERAL =================

app.post('/abonos/general', (req, res) => {
    const { clienteId, monto } = req.body;

    let restante = parseFloat(monto);

    db.query(
        'INSERT INTO abonos (cliente_id, monto) VALUES (?,?)',
        [clienteId, monto],
        (err) => {
            if (err) return res.send(err);

            db.query(
                'SELECT * FROM creditos WHERE cliente_id = ? AND estado = "pendiente" ORDER BY id ASC',
                [clienteId],
                (err, creditos) => {
                    if (err) return res.send(err);

                    function procesarCredito(index) {

                        if (index >= creditos.length || restante <= 0) {
                            return res.json({ message: 'Abono aplicado correctamente ✅' });
                        }

                        let credito = creditos[index];
                        let deuda = parseFloat(credito.valor);

                        if (restante >= deuda) {
                            restante -= deuda;

                            db.query(
                                'UPDATE creditos SET valor = 0, estado = "pagado" WHERE id = ?',
                                [credito.id],
                                (err) => {
                                    if (err) return res.send(err);
                                    procesarCredito(index + 1);
                                }
                            );

                        } else {
                            let nuevoValor = deuda - restante;

                            db.query(
                                'UPDATE creditos SET valor = ? WHERE id = ?',
                                [nuevoValor, credito.id],
                                (err) => {
                                    if (err) return res.send(err);

                                    restante = 0;
                                    return res.json({ message: 'Abono parcial aplicado ✅' });
                                }
                            );
                        }
                    }

                    procesarCredito(0);
                }
            );
        }
    );
});


// ================= ABONOS =================

app.get('/abonos', (req, res) => {
    db.query(`
        SELECT 
            abonos.id,
            abonos.monto,
            abonos.fecha,
            clientes.nombre,
            clientes.apellido1,
            clientes.apellido2,
            clientes.cedula  
        FROM abonos
        JOIN clientes ON abonos.cliente_id = clientes.id
        ORDER BY abonos.fecha DESC
    `, (err, result) => {
        if(err) res.send(err);
        else res.json(result);
    });
});


// ================= CARTERA =================

app.get('/cartera', (req, res) => {

    const queryCreditos = 'SELECT SUM(valor) AS totalCreditos FROM creditos';
    const queryAbonos = 'SELECT SUM(monto) AS totalAbonos FROM abonos';

    db.query(queryCreditos, (err, resultCreditos) => {
        if (err) return res.send(err);

        db.query(queryAbonos, (err, resultAbonos) => {
            if (err) return res.send(err);

            const totalCreditos = resultCreditos[0].totalCreditos || 0;
            const totalAbonos = resultAbonos[0].totalAbonos || 0;

            const cartera = totalCreditos - totalAbonos;

            res.json({
                totalCreditos,
                totalAbonos,
                cartera
            });
        });
    });

});


// =======================
// PUERTO (SOLO ESTE)
// =======================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor en puerto " + PORT);
});