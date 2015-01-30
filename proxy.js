var net = require('net');

var listener = net.createServer(function(socket) {
  socket.on('data', function(msg) {
    var string = msg.toString();
    // Switch to \r || \r\n
    var lines = string.split(/[\r\n]/);
    var firstLine = lines[0];
    console.log('<<< ' + firstLine);
    var modifiedString = modifyRequest(msg);
    var hostLine, hostname, port;
    for(var i=0; i<lines.length; ++i) {
      if (/^host:*/i.test(lines[i])) {
        hostLine = lines[i];
      }
    }
    var hostPort = hostLine.split(':');
    hostName = hostPort[1];
    var uriPort = firstLine.split(':');
    if (hostPort.length > 2) {
      port = hostPort[2];
    }
    else if (port == null && /:[\d]+/.test(firstLine)) {
      // Look on uri line for a port
        port = uriPort.match(/:[\d]+/)
        port = port.substring(1, port.length);
    } else {
      var protocol = firstLine.match(/^http[s]?:/);
      if (protocol == 'http') {
        port = '80';
      } else {
        port = '443';
      }
    }
    console.log('host: ' + hostName + ", port: " + port);
    // Forward the new message on to the server
  });
  socket.on('connect', function(msg) {
    console.log('msg: ' + msg);
  });
});

function modifyRequest(msg) {
  var string = msg.toString();
  var modString = string.replace(/Proxy-connection: keep-alive/gi, 'Proxy-connection: close');
  modString = modString.replace(/Connection: keep-alive/gi, 'Connection: close');
  modString = modString.replace(/ HTTP\/[12].[10]/, ' HTTP/1.0');
  console.log('Modified request: ' + modString);
  return new Buffer(modString);
}

listener.listen(1520);