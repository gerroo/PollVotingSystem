import { PollModel } from "../db/mogoose";
import { io } from "../socket";
import { Socket } from "socket.io";
import { client } from "../redis";
import { ObjectId } from "../db/schema";

async function join(socket: Socket, pollCode: string) {
  try {
    console.log(`join: ${socket.id}`);
    if (pollCode === null || pollCode === undefined)
      throw { code: 1, message: "Invalid poll code" };
    const pollId = await client.get(pollCode);
    console.log(pollId);
    if (pollId === null) throw { code: 1, message: "Invalid poll code" };

    // ensure that socket is connected to 1 room (other than the default room)
    socket.rooms.forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });

    const currSequence = await client.get(pollId);
    const hasStarted =
      currSequence == null ? false : parseInt(currSequence) > 0;
    console.log("Has Started", hasStarted);
    socket.join(pollId);
    socket.data["pollId"] = pollId;
    io.to(socket.id).emit("pollStarted", hasStarted);
  } catch (err) {
    console.log(err);
    io.to(socket.id).emit("error", err);
  }
}

async function pollResult(pollId: string, seq: number) {
  try {
    const result = await PollModel.aggregate([
      { $match: { _id: new ObjectId(pollId) } },
      { $unwind: "$students" },
      { $match: { "students.sequence": seq } },
      { $group: { _id: "$students.answer", count: { $sum: 1 } } },
    ]);
    console.log(result);
    return result;
  } catch (err) {
    console.log(err);
  }
}

async function vote(socket: Socket, answer: number, utorid: string) {
  try {
    console.log(`vote: ${socket.id}`);
    let pollId = socket.data.pollId;
    if (pollId === null || pollId === undefined)
      throw { code: 1, message: "haven't joined any room" };
    const currSequence = await client.get(pollId);
    console.log(currSequence);
    if (currSequence === null || parseInt(currSequence) < 0) {
      throw { code: 2, message: "Poll not live yet" };
    }

    if (utorid === undefined || utorid === null)
      throw { code: 1, message: "Invalid utorid" };
    if (answer === undefined || answer === null)
      throw { code: 2, message: "Invalid answer" };

    const result = await PollModel.updateOne(
      {
        _id: pollId,
        students: {
          $elemMatch: {
            utorid: utorid,
            sequence: parseInt(currSequence),
          },
        },
      },
      {
        $set: {
          "students.$.answer": answer,
          "students.$.timestamp": new Date(),
        },
      }
    );

    if (result.modifiedCount == 0)
      await PollModel.updateOne(
        {
          _id: pollId,
        },
        {
          $addToSet: {
            students: {
              utorid,
              sequence: parseInt(currSequence),
              answer,
              timestamp: new Date(),
            },
          },
        }
      );
    pollResult(pollId, parseInt(currSequence)).then((data) => {
      io.to(pollId).emit("result", data);
    });
    return;
  } catch (err) {
    console.log(err);
    io.to(socket.id).emit("error", err);
  }
}

export { vote, join, pollResult };
