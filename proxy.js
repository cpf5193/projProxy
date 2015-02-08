var net = require('net');
var dns = require('dns');
var util = require('util');


var tunnels = {};

///////////////////////////////////////////////////
// Process command line arguments
///////////////////////////////////////////////////
if (process.argv.length != 4) {
  console.log("Usage: node proxy.js <host> <port> (in run script)\n" +
              "Usage: ./run <port> (using script)");
  process.exit(1);
}
var HOST = process.argv[2];
var PORT = process.argv[3];

///////////////////////////////////////////////////
// Listener for client requests
///////////////////////////////////////////////////
var listener = net.createServer({allowHalfOpen: true}, function(socket) {
  socket.on('data', function(msg) {
    handleClientData(socket, msg);
  });
  socket.on('end', function() {
    socket.end();
  });
  socket.on('error', function(err) {
    console.log('listener: ' + err);
    socket.end();
  });
});

////////////////////////////////////////////////////////////
// Takes a message, downgrading the protocol to 1.0 and 
// changing the connection to connection: close, returning
// a Buffer with the changed header
// msg: A Buffer object containing a request from the client
////////////////////////////////////////////////////////////
function modifyRequest(msg) {
  var string = msg.toString();
  var modString = string.replace(/Proxy-connection: keep-alive/gi, 'Proxy-connection: close');
  modString = modString.replace(/Connection: keep-alive/gi, 'Connection: close');
  modString = modString.replace(/ HTTP\/[12].[10]/, ' HTTP/1.0');
  return new Buffer(modString);
}

/////////////////////////////////////////////////////////////
// Forwards a non-connect request to the appropriate server
// hostName: the name of the server to connect to
// port: the port of the server to connect to
// message: a Buffer object containing the message to send
// clientSocket: the socket of the client sending the request
/////////////////////////////////////////////////////////////
function forwardMessage(hostName, port, message, clientSocket) {
  // Create a client connection to send to the server
  var socket = new net.Socket({allowHalfOpen: true});
  try {
    socket.connect(parseInt(port), hostName, function() {
      try {
        socket.write(message);
      } catch (ex) {
        util.log('error connecting to server: ' + ex);
      }
    });
  } catch (ex) {
    console.log(ex);
  }
  
  socket.on("data", function(data) {
    try {
      if (clientSocket.writable) {
        clientSocket.write(data);
      }
    } catch (ex) {
      util.log('error writing back to client: ' + ex);
    }
  });
  socket.on('end', function() {
    socket.end();
    clientSocket.end();
  });
  socket.on('error', function(err) {
    console.log('forward message: ' + err);
  });
  socket.on('close', function() {
    socket.end();
    clientSocket.end();
  });
}

function createTunnel(hostname, port, msg, clientSocket) {
  var socket = new net.Socket({allowHalfOpen: true});
  var clientId = getSocketNameAndPort(clientSocket);
  
  try {
    socket.connect(parseInt(port), hostName, function() {
      // Send success message
      clientSocket.write(new Buffer('HTTP/1.0 200 OK\n\n'));
      tunnels[clientId] = socket;//new socket for tunnel
    });
  } catch (ex) {
    console.log('tunnel connect: ' + ex);
    clientSocket.write(new Buffer('HTTP/1.0 502 Bad Gateway\n\n'));
  }
  socket.on("error", function (err) {
    console.log('create tunnel: ' + err);
  });
  socket.on("data", function(data) {
    try {
      clientSocket.write(data);
    } catch (ex) {
      util.log('error writing to server: ' + ex);
    }
  });
  socket.on('end', function() {
    socket.end();
    clientSocket.end();
    delete tunnels[clientId];
  });
  socket.on('close', function() {
    socket.end();
    clientSocket.end();
    delete tunnels[clientId];
  });
}

function handleTunnel(clientId, msg) {
  var serverSocket = tunnels[clientId];
  serverSocket.write(msg);
}

/////////////////////////////////////////////////////////////
// Delegates a request from the client based on the
// state of the proxy
// clientSocket: the socket of the client sending the request
// msg: the Buffer object containing the client's request
/////////////////////////////////////////////////////////////
function handleClientData(clientSocket, msg) {
  var clientId = getSocketNameAndPort(clientSocket);
  var test = tunnels[clientId];
  if(tunnels[clientId] !== undefined) {
    handleTunnel(clientId, msg);
    return;
  }
  var string = msg.toString();
  var lines = string.split(/\r[\n]?/);
  var firstLine = lines[0];
  var firstLineTokens = firstLine.split(" ");
  if (lines.length > 1)
    util.log('>>> ' + firstLineTokens[0] + " " + firstLineTokens[1]);
  var hostAndPort = getHostAndPort(lines);

  // If there is no host and port, and there is no registered tunnel,
  // we know that the message is a lagging request to a tunnel that has been
  // shut down, ignore it
  if (hostAndPort != undefined) {
    if (firstLineTokens[0] == 'CONNECT') {
      createTunnel(hostAndPort['hostName'], hostAndPort['port'], msg, clientSocket);
    } else {
      var modifiedBuffer = modifyRequest(msg);
      forwardMessage(hostAndPort['hostName'], hostAndPort['port'], modifiedBuffer, clientSocket);
    }
  }
}

////////////////////////////////////////////////////////////////
// Strips off the header from msg and returns the remaining data
// msg: the string to strip the header off of
////////////////////////////////////////////////////////////////
function stripData(msg) {
  var headerAndData = msg.split(/(\r\n\r\n|\n\n)/);
  return headerAndData[1];
}


///////////////////////////////////////////////////////////////
// Takes an array of \r\n separated lines and returns an object
// { hostName: <string>, port: <int> }
///////////////////////////////////////////////////////////////
function getHostAndPort(lines) {
  var hostLine, hostname, port, firstLine;
  firstLine = lines[0];
  firstLineTokens = firstLine.split(" ");
  for(var i=0; i<lines.length; ++i) {
    if (/^host:*/i.test(lines[i])) {
      hostLine = lines[i];
    }
  }
  if (hostLine == undefined) {
    return null;
  }
  var hostPort = hostLine.split(':');
  hostName = hostPort[1].trim();
  var uriPort = firstLine.split(':');
  if (hostPort.length > 2) {
    port = hostPort[2].trim();
  }
  else if (port == null && uriPort.length > 1 && /:[\d]+$/.test(firstLine) == true) {
    // Look on uri line for a port
      port = uriPort.match(/:[\d]+/);
      port = port.substring(1, port.length);
  } else {
    var protocol = firstLineTokens[1].match(/^http[s]?:/);
    if (protocol == 'http:') {
      port = '80';
    } else {
      port = '443';
    }
  }
  var hostAndPort = {};
  hostAndPort['hostName'] = hostName;
  hostAndPort['port'] = parseInt(port);
  hostAndPort['id'] = hostName + ":" + port;
  return hostAndPort;
}

function getSocketNameAndPort(s) {
  return s.remoteAddress + ":" + s.remotePort;
}

///////////////////////////////////////////////////
// Listen for CTRL-C or EOF to terminate
///////////////////////////////////////////////////

//NOTE: Reading stdin is not supported in Cygwin
/*process.stdin.on('end', function() {
  process.exit(0);
});
*/
process.on('SIGINT', function() {
  process.exit(0);
});

///////////////////////////////////////////////////
// Start Proxy
///////////////////////////////////////////////////
listener.listen(parseInt(PORT), HOST, 5);
util.log('Proxy listening on ' + HOST + ":" + PORT);