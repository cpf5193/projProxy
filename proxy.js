var net = require('net');
var dns = require('dns');

// use commandline arguments to set port

var listener = net.createServer(function(socket) {
  socket.on('data', function(msg) {
    var string = msg.toString();
    var lines = string.split(/\r[\n]?/);
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
    hostName = hostPort[1].trim();
    var uriPort = firstLine.split(':');
    if (hostPort.length > 2) {
      port = hostPort[2].trim();
    }
    else if (port == null && /:[\d]+/.test(firstLine)) {
      // Look on uri line for a port
        port = uriPort.match(/:[\d]+/)
        port = port.substring(1, port.length);
    } else {
      //console.log('firstLine: ' + firstLine);
      var protocol = firstLine.split(' ')[1].match(/^http[s]?:/);
      //console.log('protocol: ' + protocol);
      if (protocol == 'http:') {
        port = '80';
      } else {
        port = '443';
      }
    }
    console.log('host: ' + hostName + ", port: " + port);
    forwardMessage(hostName, port, modifiedString, socket);
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
  return new Buffer(modString);
}

function forwardMessage(hostName, port, message, clientSocket) {
  // Create a client connection to send to the server
  var socket = new net.Socket();
  var hostIp;
  console.log("hostname:" + hostName);
  dns.resolve4(hostName, function(err, addresses) {
    console.log(err);
    if (!err && addresses.length > 0) {
      hostIp = addresses[0];
    } else {
      exit();
    }
    //console.log('port: ' + port);
    //console.log('hostIp: ' + hostIp);
    socket.connect(parseInt(port), hostName, function() {
      console.log('connected to ' + hostIp + ":" + port + "\n");
      console.log('writing to socket: \n' + message + "\n");
      socket.write(message);
    });
    socket.on("data", function(data) {
      console.log('data from server:\n ' + data.toString().substring(0, 500) + "\n");
      clientSocket.write(data);
    });
  });
}

listener.listen(1521);