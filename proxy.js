var net = require('net');

var listener = net.createServer(function(socket) {
  socket.on('data', function(msg) {
    console.log('msg: ' + msg);
  });
  socket.on('connect', function(msg) {
    console.log('msg: ' + msg);
  });
});

listener.listen(1520);