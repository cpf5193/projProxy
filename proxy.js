var net = require('net');

var listener = net.createServer(function(socket) {
  socket.on('data', function(msg) {
    var string = msg.toString();
    var firstLine = string.split(/[\r\n]/)[0];
    console.log('<<< ' + firstLine);
    var modifiedString = modifyRequest(msg);
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


// Not a good way to do this, need to consider payload as well
function msgToJSON(msg) {
  var string = msg.toString();
  var lines = string.split(/[\r\n]/);
  var firstLine = lines[0];
  var line, tokens, key, val;
  var json = {};
  for(var i=1; i<lines.length; ++i) {
    line = lines[i];
    if (line != '') {
      tokens = line.split(': ');
      key = tokens[0];
      value = '';
      for(var j=1; j<tokens.length; ++j) {
        // If there are more than 2, we combine all except the first one
        value += tokens[j];
      }
      json[key] = value;
    }
  }
  json['request'] = firstLine;
  return json;
}

listener.listen(1520);